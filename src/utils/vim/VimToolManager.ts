// src/utils/vim/VimToolManager.ts
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import { exec } from "child_process";
import type { VimTool, VimToolResult, VimBuffer, CommandContext, VimOptions } from "./types";
import { VIM_OPTION_DEFAULTS } from "./types";
import { PathResolver } from "./utils/PathResolver";
import { ExCommandHandler } from "./commands/ExCommandHandler";
import { NormalCommandHandler } from "./commands/NormalCommandHandler";
import { isExCommand, stripColonPrefix } from "./commands/CommandParser";
import { editFile, writeBuffer } from "./operations/FileOperations";
import { grepInDirectory } from "./operations/GrepOperations";
import { listBuffers, showRegisters, showMarks } from "./operations/BufferOperations";
import { createTwoFilesPatch } from "diff";
import { VimStateMachine } from "./commands/VimStateMachine";
import { createVimState } from "./models/VimMode";
import { validateVimToolCall } from "./VimToolCallValidator";

const readFile = fs.promises.readFile;
const writeFileAsync = fs.promises.writeFile;

export class VimToolManager {
  private static instance: VimToolManager | undefined;

  private stateMachine: VimStateMachine;
  private buffers: Map<string, VimBuffer> = new Map();
  private currentBuffer: VimBuffer | null = null;
  private sharedRegisters: Map<string, any> | null = null;
  private workingDir: string | undefined;
  private options: VimOptions = { ...VIM_OPTION_DEFAULTS };

  private pathResolver: PathResolver;
  private exHandler: ExCommandHandler;
  private normalHandler: NormalCommandHandler;

  static getInstance(): VimToolManager {
    if (!VimToolManager.instance) {
      VimToolManager.instance = new VimToolManager();
    }
    return VimToolManager.instance;
  }

  setWorkspaceRootProvider(provider: () => string | undefined): void {
    this.pathResolver.setWorkspaceRootProvider(provider);
  }

  setWorkingDir(dir: string): void {
    this.workingDir = dir;
  }

  

  constructor(workspaceRoot?: string | (() => string | undefined)) {
    let provider: () => string | undefined;
    if (typeof workspaceRoot === "function") {
      provider = workspaceRoot;
      this.workingDir = workspaceRoot();
    } else if (workspaceRoot) {
      provider = () => workspaceRoot;
      this.workingDir = workspaceRoot;
    } else {
      provider = () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      this.workingDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    }
    const workingDirProvider = () => this.workingDir;
    this.pathResolver = new PathResolver(provider, workingDirProvider);

    const self = this;
    const ctx: CommandContext = {
      buffers: this.buffers,
      getCurrentBuffer: () => self.currentBuffer,
      setCurrentBuffer: (buf) => {
        self.currentBuffer = buf;
        if (buf) {
          self.stateMachine.setBuffer(buf);
        }
      },
      resolvePath: (fp) => self.pathResolver.resolve(fp),
      get workingDir() { return self.workingDir; },
      get options() { return self.options; },
    };

    const onWorkingDirChange = (dir: string) => self.setWorkingDir(dir);
    this.exHandler = new ExCommandHandler(ctx, onWorkingDirChange);
    this.normalHandler = new NormalCommandHandler();
    this.stateMachine = new VimStateMachine(ctx, createVimState(), onWorkingDirChange);
  }

  getAvailableTools(): VimTool[] {
    return [
      {
        name: "vim",
        description: "Execute Vim commands to edit files. Primary tool for all file operations.\n\n" +
          "FORMAT RULES:\n" +
          "- Each command is a separate string in the 'commands' array\n" +
          "- 'i' (insert mode) must be separate from the text that follows\n" +
          "- '\\x1b' returns to normal mode; ':w' saves\n\n" +
          "Commands: :e :w :q :wq :q! :[range]s/pat/repl/[g|i] :[range]d :[range]y :p\n" +
          "  :[range]print (e.g. :%print :+2,+2print) :g/pat/cmd :v/pat/cmd :grep :cd :pwd :! :terminal :r :find :diff :help\n" +
          "Normal: i a A I o O dd yy p P >> << gg G j k + - 0 $ ma 'a \"ayy\n" +
          "Ranges: % . $ N N,M +N -N 'a /pat/  (+N = N lines below, -N = N lines above current)\n" +
          "Use :help or :help <topic> for detailed command reference.",
        inputSchema: {
          type: "object",
          properties: {
            commands: {
              type: "array",
              description: "Array of Vim commands to execute in sequence. Use 'i' to enter insert mode, then text as separate commands, and '\\x1b' to exit insert mode.",
              items: { type: "string" }
            },
            create_backup: {
              type: "boolean",
              description: "Create .bak backup before modifications. Defaults to true."
            }
          },
          required: ["commands"]
        }
      },
      {
        name: "vim_buffer_list",
        description: "List all open buffers and their status",
        inputSchema: { type: "object", properties: {}, required: [] }
      },
      {
        name: "vim_show_registers",
        description: "Show contents of all registers",
        inputSchema: { type: "object", properties: {}, required: [] }
      },
      {
        name: "vim_show_marks",
        description: "Show all marks in current buffer",
        inputSchema: { type: "object", properties: {}, required: [] }
      }
    ];
  }

  async callTool(
    toolName: string,
    arguments_: Record<string, any>
  ): Promise<VimToolResult> {
    console.log(`[VimToolManager] Tool call: ${toolName}`, arguments_);

    try {
      switch (toolName) {
        case "vim": {
          let cmds = arguments_.commands || [];
          if (typeof cmds === "string") {
            cmds = cmds.split('\n');
          }
          // Normalize literal \xNN and "Ctrl+X" (e.g. from XML/CDATA or LLM output) to actual characters
          cmds = (cmds as string[]).map((c: string) => {
            if (typeof c !== "string") return c;
            let s = c.replace(/\\x1b/g, "\x1b");
            s = s.replace(/\\x06/g, "\x06");
            s = s.replace(/\\x02/g, "\x02");
            s = s.replace(/\\x04/g, "\x04");
            s = s.replace(/\\x15/g, "\x15");
            // Literal "Ctrl+f", "Ctrl+b", "Ctrl+d", "Ctrl+u" (case-insensitive)
            s = s.replace(/\bCtrl\+f\b/gi, "\x06");
            s = s.replace(/\bCtrl\+b\b/gi, "\x02");
            s = s.replace(/\bCtrl\+d\b/gi, "\x04");
            s = s.replace(/\bCtrl\+u\b/gi, "\x15");
            return s;
          });
          // Skip space/tab-only commands (LLMs sometimes add " "; triggers "Unsupported normal mode command")
          // Keep "" (blank lines in insert mode), "\n"/"\r" (Enter key)
          cmds = (cmds as string[]).filter((c: string) => typeof c !== "string" || c.length === 0 || c.replace(/[\t ]/g, "").length > 0);

          const validation = validateVimToolCall(cmds, { hasBuffer: !!this.currentBuffer });
          if (!validation.valid && validation.errors.length > 0) {
            return {
              content: [{ type: "text", text: `Vim tool call validation failed:\n${validation.errors.map((e) => `  - ${e}`).join("\n")}` }],
              isError: true,
            };
          }

          return await this.vimEdit(cmds, arguments_.create_backup !== false);
        }
        case "vim_buffer_list":
          return listBuffers(this.buffers, this.currentBuffer);
        case "vim_show_registers":
          return showRegisters(this.currentBuffer);
        case "vim_show_marks":
          return showMarks(this.currentBuffer);
        default:
          return {
            content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
            isError: true
          };
      }
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true
      };
    }
  }

  /** Commands that can run without an active buffer (no file open). */
  private canRunWithoutBuffer(cmd: string): boolean {
    if (/^:\s*(pwd|cd\s|!|grep(\s|$))/.test(cmd)) return true;
    const diffMatch = cmd.match(/^:dif+f?\s+(.+)$/s);
    if (diffMatch) {
      const args = diffMatch[1].trim().split(/\s+/).filter(Boolean);
      return args.length >= 2; // :diff file1 file2 can run without buffer
    }
    return false;
  }

  /** Run only :pwd, :cd, :!, :grep, :diff (two args) without opening a buffer or using the state machine. */
  private async runDirectoryCommandsOnly(commands: string[]): Promise<VimToolResult | null> {
    let wd = this.workingDir || this.pathResolver.workspaceRoot || process.cwd();
    if (!wd) {
      return {
        content: [{ type: "text", text: "Cannot run :pwd/:cd/:!/:grep without a working directory." }],
        isError: true
      };
    }
    const outputs: string[] = [];
    const execAsync = promisify(exec);

    for (const raw of commands) {
      const c = String(raw).trim();
      if (/^:pwd\s*$/.test(c)) {
        outputs.push(wd);
        continue;
      }
      const cdMatch = c.match(/^:cd\s+(.+)$/s);
      if (cdMatch) {
        let targetPath = cdMatch[1].trim();
        if (!targetPath) {
          const homedir = require("os").homedir();
          this.setWorkingDir(homedir);
          wd = homedir;
          outputs.push(`Changed directory to ${homedir}`);
          continue;
        }
        if ((targetPath.startsWith('"') && targetPath.endsWith('"')) || (targetPath.startsWith("'") && targetPath.endsWith("'"))) {
          targetPath = targetPath.slice(1, -1);
        } else {
          const sp = targetPath.indexOf(" ");
          if (sp > 0) targetPath = targetPath.slice(0, sp);
        }
        const resolved = this.pathResolver.resolve(targetPath);
        if (!fs.existsSync(resolved)) {
          return { content: [{ type: "text", text: `Directory not found: ${targetPath}` }], isError: true };
        }
        if (!fs.statSync(resolved).isDirectory()) {
          return { content: [{ type: "text", text: `Not a directory: ${targetPath}` }], isError: true };
        }
        this.setWorkingDir(resolved);
        wd = resolved;
        outputs.push(`Changed directory to ${resolved}`);
        continue;
      }
      const bangMatch = c.match(/^:!\s*(.+)$/s);
      if (bangMatch) {
        const shellCmd = bangMatch[1].trim();
        if (!shellCmd) {
          return { content: [{ type: "text", text: ":! requires a shell command" }], isError: true };
        }
        try {
          const { stdout, stderr } = await execAsync(shellCmd, { cwd: wd });
          const out = [stdout, stderr].filter(Boolean).join("\n").trimEnd();
          if (out) outputs.push(out);
        } catch (err: any) {
          return {
            content: [{ type: "text", text: `Shell command failed: ${err.message || String(err)}` }],
            isError: true
          };
        }
        continue;
      }
      if (/^:grep\s*$/.test(c)) {
        return { content: [{ type: "text", text: ":grep requires a pattern" }], isError: true };
      }
      const grepMatch = c.match(/^:grep\s+(.+)$/s);
      if (grepMatch) {
        const rest = grepMatch[1].trim();
        if (!rest) {
          return { content: [{ type: "text", text: ":grep requires a pattern" }], isError: true };
        }
        const parts = rest.split(/\s+/);
        let pattern = parts[0];
        let searchDir = wd;
        let filePattern: string | undefined;
        if (parts.length >= 2) {
          const second = parts[1];
          const resolved = this.pathResolver.resolve(second);
          if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
            searchDir = resolved;
            filePattern = parts[2];
          } else {
            filePattern = second;
          }
        }
        try {
          const { text, isError } = await grepInDirectory(pattern, searchDir, filePattern);
          if (isError) return { content: [{ type: "text", text }], isError: true };
          outputs.push(text);
        } catch (err: any) {
          return { content: [{ type: "text", text: `grep failed: ${err.message}` }], isError: true };
        }
        continue;
      }
      const diffMatch = c.match(/^:dif+f?\s+(.+)$/s);
      if (diffMatch) {
        const args = diffMatch[1].trim().split(/\s+/).filter(Boolean);
        if (args.length < 2) {
          return {
            content: [{ type: "text", text: ":diff with one argument requires an active buffer. Use :e <file> first, then :diff <file>." }],
            isError: true
          };
        }
        const p1 = this.pathResolver.resolve(args[0]);
        const p2 = this.pathResolver.resolve(args[1]);
        try {
          const oldStr = fs.readFileSync(p1, "utf-8");
          const newStr = fs.readFileSync(p2, "utf-8");
          const oldLabel = path.relative(wd, p1) || p1;
          const newLabel = path.relative(wd, p2) || p2;
          const patch = createTwoFilesPatch(oldLabel, newLabel, oldStr, newStr);
          outputs.push((!patch || !patch.includes("@@")) ? "(no differences)" : patch);
        } catch (err: any) {
          return { content: [{ type: "text", text: `diff failed: ${err.message}` }], isError: true };
        }
        continue;
      }
      outputs.push(`Unknown directory command: ${c}`);
    }

    return {
      content: [{ type: "text", text: outputs.join("\n") }]
    };
  }

private async vimEdit(
  commands: string[],
  createBackup: boolean = true
): Promise<VimToolResult> {

  try {
    const ctx: CommandContext = {
      buffers: this.buffers,
      getCurrentBuffer: () => this.currentBuffer,
      setCurrentBuffer: (buf) => {
        this.currentBuffer = buf;
        if (buf) {
          this.stateMachine.setBuffer(buf);
        }
      },
      resolvePath: (fp) => this.pathResolver.resolve(fp),
      options: this.options,
    };

    if (!this.currentBuffer && commands.length > 0) {
      const firstCmd = typeof commands[0] === "string" ? commands[0].trim() : "";
      const eMatch = firstCmd.match(/^:e\s+(.+)$/s);
      if (eMatch) {
        const filename = eMatch[1].trim();
        await editFile(filename, ctx);
      } else if (commands.every((c) => this.canRunWithoutBuffer(String(c).trim()))) {
        // Directory/shell-only or :diff: run without a buffer (no state machine)
        const result = await this.runDirectoryCommandsOnly(commands);
        if (result) return result;
      }
    }

    if (!this.currentBuffer) {
      return {
        content: [{
          type: "text",
          text: "No file specified and no active buffer. Use :e <file> to edit a file or :pwd/:cd/:!/:grep for directory/shell."
        }],
        isError: true
      };
    }

    const buffer = this.currentBuffer!;
    this.stateMachine.setBuffer(buffer);

    // Share registers across buffers
    if (!this.sharedRegisters) {
      this.sharedRegisters = buffer.registers;
    } else if (buffer.registers !== this.sharedRegisters) {
      const filePath_ = buffer.path;
      buffer.registers = this.sharedRegisters;
      buffer.registers.set('%', { type: 'linewise', content: [filePath_] });
    }

    let backupPath: string | undefined;
    if (createBackup && fs.existsSync(buffer.path)) {
      backupPath = buffer.path + '.bak';
      const onDiskContent = await readFile(buffer.path, 'utf-8');
      await writeFileAsync(backupPath, onDiskContent, 'utf-8');
    }

    let currentOutput = '';

    // Normalize range commands without leading colon (e.g. 1,$d -> :1,$d)
    const expandedCommands: string[] = [];
    for (const c of commands) {
      const trimmed = typeof c === "string" ? c.trim() : String(c);
      if (
        !trimmed.startsWith(':') &&
        /^(\d+\s*[,;]\s*(\d+|\$|\.)\s*|%\s*)[a-z!]/i.test(trimmed)
      ) {
        expandedCommands.push(':' + trimmed);
      } else {
        expandedCommands.push(c);
      }
    }
    commands = expandedCommands;

    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i];
      
      if (cmd === '\n' || cmd === '\r') {
        const result = await this.stateMachine.processKey('\n');
        if (result.output) {
          currentOutput += result.output;
        }
        continue;
      }

      for (const char of cmd) {
        const result = await this.stateMachine.processKey(char);
        if (result.output) {
          // Skip command-line mode intermediate echoes (partial command buffer on each keystroke)
          const curState = this.stateMachine.getState();
          if (curState.mode === 'command-line') {
            continue;
          }
          if (result.output.includes('-- INSERT --') || result.output.includes('-- NORMAL --')) {
            currentOutput += result.output + '\n';
          } else if (result.output !== '\n') {
            currentOutput += result.output;
          }
        }
      }

      // Bare numeric command (e.g. "5") → treat as "go to line 5"
      const flushResult = this.stateMachine.flushPending();
      if (flushResult?.output) {
        currentOutput += flushResult.output;
      }

      const state = this.stateMachine.getState();
      const isBareModeSwitch = /^[iaIAoO]$/.test(cmd);
      if (
        state.mode === 'insert' &&
        i < commands.length - 1 &&
        !isBareModeSwitch
      ) {
        const nextCmd = commands[i + 1];
        const isControlOnly = /^[\b\x7f]+$/.test(nextCmd);
        if (nextCmd !== '\x1b' && !nextCmd.startsWith(':') && !isControlOnly) {
          const result = await this.stateMachine.processKey('\n');
          if (result.output) {
            currentOutput += result.output;
          }
        }
      }

      if (state.mode === 'command-line' && cmd.startsWith(':')) {
        const result = await this.stateMachine.processKey('\n');
        if (result.output) {
          currentOutput += result.output + '\n';
        }
        if (result.output && result.output.startsWith('Error:')) {
          throw new Error(result.output.replace(/^Error:\s*Error:\s*/, ''));
        }
      }

      if (!this.currentBuffer) {
        break;
      }
    }

    const finalState = this.stateMachine.getState();
    if (finalState.mode === 'insert') {
      await this.stateMachine.processKey('\x1b');
      currentOutput += '\n-- NORMAL --\n';
    } else if (finalState.mode === 'command-line') {
      await this.stateMachine.processKey('\x1b');
    }

    if (backupPath) {
      try { await fs.promises.unlink(backupPath); } catch { /* ignore */ }
    }

    const state = this.stateMachine.getState();
    const cmdSummary = commands
      .filter(c => c !== '\x1b' && c !== '\n' && c !== '\r')
      .map(c => c.length > 80 ? c.substring(0, 80) + '...' : c)
      .join(', ');
    const trimmedOutput = currentOutput.trim();
    return {
      content: [{
        type: "text",
        text: `Executed ${commands.length} command(s): ${cmdSummary}\n` +
          (trimmedOutput ? `${trimmedOutput}\n\n` : '\n') +
          `Current buffer: ${path.basename(this.currentBuffer?.path || '')} ` +
          `[${this.currentBuffer?.modified ? '+' : ''}] ` +
          `Mode: ${state.mode}`
      }]
    };
  } catch (error: any) {
    if (createBackup && this.currentBuffer) {
      try {
        const backupPath = this.currentBuffer.path + '.bak';
        if (fs.existsSync(backupPath)) {
          const backup = await readFile(backupPath, 'utf-8');
          await writeFileAsync(this.currentBuffer.path, backup, 'utf-8');
        }
      } catch { /* ignore */ }
    }

    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true
    };
  }
}

  getViewState(): {
    fileName: string;
    filePath: string;
    lines: string[];
    cursorLine: number;
    mode: string;
    modified: boolean;
    commandBuffer: string;
    totalLines: number;
    list: boolean;
    tabstop: number;
    viewportTop?: number;
  } | null {
    if (!this.currentBuffer) {
      return null;
    }
    const state = this.stateMachine.getState();
    const buf = this.currentBuffer;
    const VIM_ROWS = 24;
    const totalLines = buf.content.length;
    const cursorLine = buf.currentLine;
    const viewportTop =
      buf.viewportTop !== undefined
        ? buf.viewportTop
        : Math.max(0, Math.min(cursorLine, Math.max(0, totalLines - VIM_ROWS)));

    return {
      fileName: require("path").basename(buf.path),
      filePath: buf.path,
      lines: buf.content,
      cursorLine,
      mode: state.mode,
      modified: buf.modified,
      commandBuffer: state.mode === "command-line" ? state.commandBuffer : "",
      totalLines,
      list: this.options.list,
      tabstop: this.options.tabstop,
      viewportTop,
    };
  }

  private async executeCommand(cmd: string, buffer: VimBuffer): Promise<string> {
    if (isExCommand(cmd)) {
      return this.exHandler.execute(stripColonPrefix(cmd), buffer);
    }
    if (/^'[a-z],/.test(cmd)) {
      return this.exHandler.execute(cmd, buffer);
    }
    return this.normalHandler.execute(cmd, buffer, this.options);
  }
}