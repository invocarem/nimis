// src/utils/vim/VimToolManager.ts
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
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

  constructor(workspaceRoot?: string | (() => string | undefined)) {
    let provider: () => string | undefined;
    if (typeof workspaceRoot === "function") {
      provider = workspaceRoot;
    } else if (workspaceRoot) {
      provider = () => workspaceRoot;
    } else {
      provider = () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    }

    this.pathResolver = new PathResolver(provider);

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

    this.exHandler = new ExCommandHandler(ctx);
    this.normalHandler = new NormalCommandHandler();
    this.stateMachine = new VimStateMachine(ctx, createVimState());
  }

  getAvailableTools(): VimTool[] {
    return [
      {
        name: "vim_edit",
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
          "  :w            - Write current buffer to disk\n" +
          "  :q            - Close current buffer (fails if modified)\n" +
          "  :wq           - Write and close\n" +
          "  :q!           - Force close (discard changes)\n" +
          "  :bn           - Next buffer\n" +
          "  :bp           - Previous buffer\n" +
          "  :ls           - List all buffers\n" +
          "  :b <num>      - Switch to buffer number\n\n" +
          "Editing Commands:\n" +
          "  :[range]s/pattern/repl/[g] - Substitute\n" +
          "  :[range]d [reg]             - Delete lines into register\n" +
          "  :[range]y [reg]             - Yank lines into register\n" +
          "  :[reg]p                      - Put after current line\n" +
          "  :[reg]P                      - Put before current line\n" +
          "  :[range]!<cmd>                - Filter lines through shell\n" +
          "  :g/pattern/cmd                - Global command\n" +
          "  :v/pattern/cmd                - Inverse global\n" +
          "  :[range]norm <cmd>            - Execute normal commands\n\n" +
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
          "✅ Delete lines matching pattern:\n" +
          "  commands: [\n" +
          "    \":g/^\\s*console\\.log/d\",\n" +
          "    \":w\"\n" +
          "  ]\n\n" +
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
        case "vim_edit": {
          let cmds = arguments_.commands || [];
          if (typeof cmds === "string") {
            cmds = cmds.split('\n').filter((line: string) => line.trim() !== '');
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

private async vimEdit(
  commands: string[],
  filePath?: string,
  createBackup: boolean = true
): Promise<VimToolResult> {

  try {
    if (filePath) {
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
      await editFile(filePath, ctx);
    } else if (!this.currentBuffer) {
      return {
        content: [{
          type: "text",
          text: "No file specified and no active buffer. Use :e <file> to edit a file."
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
        // Don't add newline before escape or colon commands
        if (nextCmd !== '\x1b' && !nextCmd.startsWith(':')) {
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