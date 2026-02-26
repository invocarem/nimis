// src/utils/vim/VimToolManager.ts
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import { exec } from "child_process";
import type { VimTool, VimToolResult, VimBuffer, CommandContext } from "./types";
import { PathResolver } from "./utils/PathResolver";
import { ExCommandHandler } from "./commands/ExCommandHandler";
import { NormalCommandHandler } from "./commands/NormalCommandHandler";
import { isExCommand, stripColonPrefix } from "./commands/CommandParser";
import { editFile, writeBuffer } from "./operations/FileOperations";
import { listBuffers, showRegisters, showMarks } from "./operations/BufferOperations";
import { VimStateMachine } from "./commands/VimStateMachine";
import { createVimState } from "./models/VimMode";

const readFile = fs.promises.readFile;
const writeFileAsync = fs.promises.writeFile;

export class VimToolManager {
  private static instance: VimToolManager | undefined;

  private stateMachine: VimStateMachine;
  private buffers: Map<string, VimBuffer> = new Map();
  private currentBuffer: VimBuffer | null = null;
  private sharedRegisters: Map<string, any> | null = null;
  private workingDir: string | undefined;

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
        description: "Execute Vim commands to edit files. This is your primary tool for all file operations.\n\n" +
          "Core Philosophy:\n" +
          "- All file operations are done through Vim commands\n" +
          "- Maintains buffer state across commands\n" +
          "- Supports registers, marks, and ranges\n\n" +
          "IMPORTANT: COMMAND FORMAT RULES\n" +
          "- Each command must be a separate string in the 'commands' array\n" +
          "- Use 'i' to enter insert mode, then type your text in separate commands\n" +
          "- Use '\\x1b' (Escape) to return to normal mode\n" +
          "- Always include ':w' at the end to save changes\n\n" +
          "Basic Commands:\n" +
          "  :e <file>     - Edit file (opens/creates in buffer)\n" +
          "  :[range]print  - Print lines (output returned in result). Use :%print to read full file.\n" +
          "  :[range]print # - Print with line numbers\n" +
          "  :w            - Write current buffer to disk\n" +
          "  :q            - Close current buffer (fails if modified)\n" +
          "  :wq           - Write and close\n" +
          "  :q!           - Force close (discard changes)\n" +
          "  :bn           - Next buffer\n" +
          "  :bp           - Previous buffer\n" +
          "  :ls           - List all buffers\n" +
          "  :b <num>      - Switch to buffer number\n\n" +
          "Editing Commands:\n" +
          "  :[range]s/pattern/repl/[flags] - Substitute (see below)\n" +
          "  :[range]d [reg]             - Delete lines into register\n" +
          "  :[range]y [reg]             - Yank lines into register\n" +
          "  :[reg]p                      - Put after current line\n" +
          "  :[reg]P                      - Put before current line\n" +
          "  :[range]!<cmd>                - Filter lines through shell\n" +
          "  :g/pattern/cmd                - Global command\n" +
          "  :v/pattern/cmd                - Inverse global\n" +
          "  :[range]norm <cmd>            - Execute normal commands\n\n" +
          "Directory Commands:\n" +
          "  :pwd          - Print current working directory\n" +
          "  :cd <dir>     - Change to specified directory\n" +
          "Normal Mode Commands (no colon):\n" +
          "  i             - Enter insert mode\n" +
          "  a             - Enter insert mode after cursor\n" +
          "  A             - Enter insert mode at end of line\n" +
          "  I             - Enter insert mode at beginning of line\n" +
          "  o             - Open new line below and enter insert mode\n" +
          "  O             - Open new line above and enter insert mode\n" +
          "  dd            - Delete current line\n" +
          "  3dd           - Delete 3 lines\n" +
          "  yy            - Yank current line\n" +
          "  p             - Put after cursor\n" +
          "  P             - Put before cursor\n" +
          "  j/k           - Move down/up\n" +
          "  gg/G          - Go to top/bottom\n" +
          "  0/$           - Go to start/end of line\n" +
          "  ma            - Set mark a at current line\n" +
          "  'a            - Jump to mark a\n" +
          "  \"ayy          - Yank line to register a\n\n" +
          "File Operations:\n" +
          "  :r <file>      - Read file into current buffer\n" +
          "  :saveas <file> - Save buffer to new file\n" +
          "  :!mkdir -p <dir> - Create directory\n" +
          "  :!ls [dir]      - List files\n" +
          "  :!find <pattern> - Find files by name\n" +
          "  :!grep <pattern> - Search in files\n\n" +
          "Marks and Registers:\n" +
          "  ma            - Set mark a at current line\n" +
          "  'a            - Jump to mark a (in commands)\n" +
          "  \"ayy          - Yank line to register a\n" +
          "  \"ap           - Put from register a\n" +
          "  :reg          - Show registers\n\n" +
          "Range Formats:\n" +
          "  %             - Entire file\n" +
          "  .             - Current line\n" +
          "  $             - Last line\n" +
          "  'a            - Mark a\n" +
          "  /pattern/     - Next line with pattern\n" +
          "  10            - Line 10\n" +
          "  10,20         - Lines 10-20\n" +
          "  .,+5          - Current through next 5 lines\n\n" +
          "Substitute (:s) - IMPORTANT:\n" +
          "  The pattern is a regular expression (like Vim). To match literal characters that are\n" +
          "  special in regex, escape them: \\( \\) for parentheses, \\. for dot, \\* for asterisk.\n" +
          "  Example - match literal 'def greet():' then replace:\n" +
          "    :%s/def greet\\(\\):/def greet(name=\"World\"):/\n" +
          "  Use a different delimiter if pattern/replacement contain '/': :%s#/usr/local#/opt#g\n" +
          "  Flags: g = replace all on each line (default: first only), i = case-insensitive.\n\n" +
          "EXAMPLES - CORRECT USAGE:\n\n" +
          "✅ Create new file with content:\n" +
          "  commands: [\n" +
          "    \"i\",                     # Enter insert mode\n" +
          "    \"#!/usr/bin/env python3\",  # Type first line\n" +
          "    \"\\n\",                    # New line\n" +
          "    \"def main():\",            # Type function definition\n" +
          "    \"\\n\",                    # New line\n" +
          "    \"    print('Hello')\",     # Type indented line\n" +
          "    \"\\x1b\",                   # Escape to normal mode\n" +
          "    \":w\"                      # Save\n" +
          "  ]\n\n" +
          "✅ Search and replace:\n" +
          "  commands: [\n" +
          "    \":%s/oldFunction/newFunction/g\",\n" +
          "    \":w\"\n" +
          "  ]\n\n" +
          "✅ Substitute with literal parentheses (escape \\( \\) in pattern):\n" +
          "  commands: [\n" +
          "    \":%s/def greet\\\\\\(\\\\\\):/def greet(name=\\\"World\\\"):/\",\n" +
          "    \":w\"\n" +
          "  ]\n\n" +
          "✅ Delete lines matching pattern:\n" +
          "  commands: [\n" +
          "    \":g/^\\s*console\\.log/d\",\n" +
          "    \":w\"\n" +
          "  ]\n\n" +
          "✅ Read file content (use instead of read_file):\n" +
          "  file_path: \"path/to/file\", commands: [\":%print\"]\n" +
          "  Or: commands: [\":e path/to/file\", \":%print\"]\n\n" +
          "❌ INCORRECT - DON'T DO THIS:\n" +
          "  commands: [\n" +
          "    \"i#!/usr/bin/env python3\"  # WRONG - i should be separate from text\n" +
          "  ]",
        inputSchema: {
          type: "object",
          properties: {
            commands: {
              type: "array",
              description: "Array of Vim commands to execute in sequence. Use 'i' to enter insert mode, then text as separate commands, and '\\x1b' to exit insert mode.",
              items: { type: "string" }
            },
            file_path: {
              type: "string",
              description: "Optional file to edit. If not provided, uses current buffer or opens last edited file."
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
          // Normalize literal \x1b (e.g. from XML/CDATA or LLM output) to actual ESC character
          cmds = (cmds as string[]).map((c: string) =>
            typeof c === "string" ? c.replace(/\\x1b/g, "\x1b") : c
          );
          return await this.vimEdit(
            cmds,
            arguments_.file_path,
            arguments_.create_backup !== false
          );
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

  /** Run only :pwd, :cd, :! commands without opening a buffer or using the state machine. */
  private async runDirectoryCommandsOnly(commands: string[]): Promise<VimToolResult | null> {
    let wd = this.workingDir || this.pathResolver.workspaceRoot || process.cwd();
    if (!wd) {
      return {
        content: [{ type: "text", text: "Cannot run :pwd/:cd/:! without a working directory." }],
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
      outputs.push(`Unknown directory command: ${c}`);
    }

    return {
      content: [{ type: "text", text: outputs.join("\n") }]
    };
  }

private async vimEdit(
  commands: string[],
  filePath?: string,
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
    };

    let scratchPath: string | undefined;

    if (filePath) {
      await editFile(filePath, ctx);
    } else if (!this.currentBuffer && commands.length > 0) {
      const firstCmd = typeof commands[0] === "string" ? commands[0].trim() : "";
      const eMatch = firstCmd.match(/^:e\s+(.+)$/s);
      if (eMatch) {
        const filename = eMatch[1].trim();
        await editFile(filename, ctx);
      } else if (commands.every((c) => /^:\s*(pwd|cd\s|!)/.test(String(c).trim()))) {
        // Directory/shell-only: run without a buffer (no state machine)
        const result = await this.runDirectoryCommandsOnly(commands);
        if (result) return result;
      }
    }

    if (!this.currentBuffer) {
      return {
        content: [{
          type: "text",
          text: "No file specified and no active buffer. Use :e <file> to edit a file or :pwd/:cd/:! for directory/shell."
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

    const results: string[] = [];
    let currentOutput = '';
    let commandCount = 0;

    // Expand :Nx (e.g. :21i) into :N + x for LLM-generated command compatibility
    const expandedCommands: string[] = [];
    for (const c of commands) {
      const trimmed = typeof c === "string" ? c.trim() : String(c);
      const match = trimmed.match(/^:(\d+)([iaIAoO])$/);
      if (match) {
        expandedCommands.push(":" + match[1]);
        expandedCommands.push(match[2]);
      } else {
        expandedCommands.push(c);
      }
    }
    commands = expandedCommands;

    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i];
      
      if (cmd === '\n' || cmd === '\r') {
        // Handle newline as Enter key in insert mode
        const result = await this.stateMachine.processKey('\n');
        if (result.output) {
          currentOutput += result.output;
        }
        commandCount++;
        continue;
      }

      // Process each character in the command
      for (const char of cmd) {
        const result = await this.stateMachine.processKey(char);
        if (result.output) {
          // Don't add extra newlines for mode indicators
          if (result.output.includes('-- INSERT --') || result.output.includes('-- NORMAL --')) {
            currentOutput += result.output + '\n';
          } else if (result.output !== '\n') {
            currentOutput += result.output;
          }
        }
        commandCount++;
      }

      // CRITICAL FIX: After processing a command in insert mode, add a newline
      // to separate it from the next command (unless it's the last command).
      // Skip for bare mode-switch commands (i, a, I, A, o, O) - they don't insert
      // content; the next command is the first line to type.
      const state = this.stateMachine.getState();
      const isBareModeSwitch = /^[iaIAoO]$/.test(cmd);
      if (
        state.mode === 'insert' &&
        i < commands.length - 1 &&
        !isBareModeSwitch
      ) {
        const nextCmd = commands[i + 1];
        // Don't add newline before escape, colon commands, or control keys (e.g. backspace)
        const isControlOnly = /^[\b\x7f]+$/.test(nextCmd);
        if (nextCmd !== '\x1b' && !nextCmd.startsWith(':') && !isControlOnly) {
          const result = await this.stateMachine.processKey('\n');
          if (result.output) {
            currentOutput += result.output;
          }
          commandCount++;
        }
      }

      // After processing the command, if we're in command-line mode and this looks like an Ex command, press Enter
      if (state.mode === 'command-line' && cmd.startsWith(':')) {
        const result = await this.stateMachine.processKey('\n');
        if (result.output) {
          currentOutput += result.output + '\n';
        }
        commandCount++;

        if (result.output && result.output.startsWith('Error:')) {
          throw new Error(result.output.replace(/^Error:\s*Error:\s*/, ''));
        }
      }

      if (!this.currentBuffer) {
        break;
      }
    }

    // Ensure we're in normal mode before saving
    const finalState = this.stateMachine.getState();
    if (finalState.mode === 'insert') {
      await this.stateMachine.processKey('\x1b');
      currentOutput += '\n-- NORMAL --\n';
      commandCount++;
    } else if (finalState.mode === 'command-line') {
      // Cancel command-line mode if we're stuck
      await this.stateMachine.processKey('\x1b');
      commandCount++;
    }

    if (backupPath) {
      try { await fs.promises.unlink(backupPath); } catch { /* ignore */ }
    }

    const state = this.stateMachine.getState();
    return {
      content: [{
        type: "text",
        text: `Executed ${commandCount} command(s):\n${currentOutput}\n\n` +
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

  private async executeCommand(cmd: string, buffer: VimBuffer): Promise<string> {
    if (isExCommand(cmd)) {
      return this.exHandler.execute(stripColonPrefix(cmd), buffer);
    }
    if (/^'[a-z],/.test(cmd)) {
      return this.exHandler.execute(cmd, buffer);
    }
    return this.normalHandler.execute(cmd, buffer);
  }
}