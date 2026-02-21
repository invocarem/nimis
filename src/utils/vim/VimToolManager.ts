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

const readFile = fs.promises.readFile;
const writeFileAsync = fs.promises.writeFile;

export class VimToolManager {
  private static instance: VimToolManager | undefined;

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
      setCurrentBuffer: (buf) => { this.currentBuffer = buf; },
      resolvePath: (fp) => this.pathResolver.resolve(fp),
    };

    this.exHandler = new ExCommandHandler(ctx);
    this.normalHandler = new NormalCommandHandler();
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
          "Examples:\n" +
          "  # Create and edit a new file\n" +
          "  :e src/app.ts\n" +
          "  i// New file\n" +
          "  :w\n\n" +
          "  # Replace all occurrences\n" +
          "  :%s/oldFunction/newFunction/g\n\n" +
          "  # Delete all console.log lines\n" +
          "  :g/^\\s*console\\.log/d\n\n" +
          "  # Copy a function to another file\n" +
          "  :/function foo/,/^}/y a\n" +
          "  :e other.ts\n" +
          "  'ap\n\n" +
          "  # Search for files and edit\n" +
          "  :!find *.ts\n" +
          "  :e foundfile.ts\n\n" +
          "  # Create directory and file\n" +
          "  :!mkdir -p src/components\n" +
          "  :e src/components/Button.tsx",
        inputSchema: {
          type: "object",
          properties: {
            commands: {
              type: "array",
              description: "Array of Vim commands to execute in sequence. Commands maintain buffer state.",
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
        case "vim_edit":
          return await this.vimEdit(
            arguments_.commands || [],
            arguments_.file_path,
            arguments_.create_backup !== false
          );
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
          setCurrentBuffer: (buf) => { this.currentBuffer = buf; },
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

      // Share registers across buffers so yanked/deleted text is available globally
      if (!this.sharedRegisters) {
        this.sharedRegisters = buffer.registers;
      } else if (buffer.registers !== this.sharedRegisters) {
        const filePath_ = buffer.path;
        buffer.registers = this.sharedRegisters;
        buffer.registers.set('%', { type: 'linewise', content: [filePath_] });
      }

      let backupPath: string | undefined;
      if (createBackup && buffer.modified && fs.existsSync(buffer.path)) {
        backupPath = buffer.path + '.bak';
        const currentContent = buffer.content.join(buffer.lineEnding);
        await writeFileAsync(backupPath, currentContent, 'utf-8');
      }

      const results: string[] = [];
      for (const cmd of commands) {
        const result = await this.executeCommand(cmd.trim(), buffer);
        results.push(result);
        if (!this.currentBuffer) {
          break;
        }
      }

      if (this.currentBuffer && this.currentBuffer.modified) {
        await writeBuffer(this.currentBuffer);
      }

      if (backupPath) {
        try { await fs.promises.unlink(backupPath); } catch { /* ignore */ }
      }

      return {
        content: [{
          type: "text",
          text: `Executed ${commands.length} command(s):\n${results.join('\n')}\n\n` +
            `Current buffer: ${path.basename(this.currentBuffer?.path || '')} ` +
            `[${this.currentBuffer?.modified ? '+' : ''}]`
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
    // Range commands starting with mark references (e.g. 'a,'by c) are ex commands
    if (/^'[a-z],/.test(cmd)) {
      return this.exHandler.execute(cmd, buffer);
    }
    return this.normalHandler.execute(cmd, buffer);
  }
}
