import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import { exec } from "child_process";
import { assertWithinWorkspace } from "./workspacePath";

const stat = promisify(fs.stat);

export interface NativeTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface NativeToolResult {
  content: Array<{
    type: string;
    text?: string;
    [key: string]: any;
  }>;
  isError?: boolean;
}

export class NativeToolsManager {
  private static instance: NativeToolsManager | undefined;

  static getInstance(): NativeToolsManager {
    if (!NativeToolsManager.instance) {
      NativeToolsManager.instance = new NativeToolsManager();
    }
    return NativeToolsManager.instance;
  }

  /**
   * Update the workspace root provider on the singleton (or any instance).
   */
  setWorkspaceRootProvider(provider: () => string | undefined): void {
    this._workspaceRootProvider = provider;
  }

  private _workspaceRootProvider: () => string | undefined;

  private get workspaceRoot(): string | undefined {
    return this._workspaceRootProvider();
  }

  constructor(workspaceRoot?: string | (() => string | undefined)) {
    if (typeof workspaceRoot === "function") {
      this._workspaceRootProvider = workspaceRoot;
    } else if (workspaceRoot) {
      this._workspaceRootProvider = () => workspaceRoot;
    } else {
      this._workspaceRootProvider = () =>
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    }
  }

  getAvailableTools(): NativeTool[] {
    return [
      {
        name: "exec_terminal",
        description:
          "Execute a shell command in the terminal. Use this to run scripts, execute programs, change directories, or run any command-line operations. Supports command chaining with && (e.g., 'cd /path/to/folder && python calc.py'). Returns the command output. The command runs in the workspace root directory by default, or in the specified working_directory. IMPORTANT: Never use .nimis folder as working_directory - it's only for storing metadata files.\n\n" +
          "FORMAT (use child elements, same style as vim tool):\n" +
          "<tool_call name=\"exec_terminal\">\n" +
          "  <command>python calc.py</command>\n" +
          "  <working_directory>src</working_directory>\n" +
          "</tool_call>",
        inputSchema: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description:
                "The command to execute (e.g., 'cd /path/to/dir && python calc.py', 'python calc.py', 'npm install', etc.). Supports command chaining with &&, ;, and | operators.",
            },
            working_directory: {
              type: "string",
              description:
                "Optional working directory for the command. If not provided, uses workspace root or working files' directories. Do NOT use .nimis folder.",
            },
          },
          required: ["command"],
        },
      },
    ];
  }

  async callTool(
    toolName: string,
    arguments_: Record<string, any>
  ): Promise<NativeToolResult> {
    console.log(`[NativeToolManager] Tool call: ${toolName}`, arguments_);
    try {
      if (toolName === "exec_terminal") {
        return await this.executeTerminalCommand(
          arguments_.command,
          arguments_.working_directory
        );
      }
      return {
        content: [
          {
            type: "text",
            text: `Unknown tool: ${toolName}`,
          },
        ],
        isError: true,
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Error executing ${toolName}: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * Convenience method to execute a shell command directly.
   * Use this when you know you're running exec_terminal (e.g., benchRunner, scripts).
   * For generic tool dispatch, use callTool("exec_terminal", { command, working_directory }).
   */
  async executeCommand(
    command: string,
    workingDirectory?: string
  ): Promise<NativeToolResult> {
    return this.callTool("exec_terminal", {
      command,
      working_directory: workingDirectory,
    });
  }

  private resolvePath(
    filePath: string,
    useCurrentEditor: boolean = false
  ): string {
    const resolved = this.resolvePathRaw(filePath, useCurrentEditor);
    if (this.workspaceRoot) {
      assertWithinWorkspace(resolved, this.workspaceRoot);
    }
    return resolved;
  }

  private resolvePathRaw(
    filePath: string,
    useCurrentEditor: boolean = false
  ): string {
    if (path.isAbsolute(filePath)) {
      return path.resolve(filePath);
    }

    const wsRoot = this.workspaceRoot;

    if (filePath === "." || filePath === "./") {
      if (useCurrentEditor) {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document && !editor.document.isUntitled) {
          return path.dirname(editor.document.fileName);
        }
      }
      if (wsRoot) {
        return wsRoot;
      }
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document && !editor.document.isUntitled) {
        return path.dirname(editor.document.fileName);
      }
      console.warn(
        `[NativeTools] No workspace root found, using process.cwd(): ${process.cwd()}`
      );
      return process.cwd();
    }

    if (wsRoot) {
      return path.resolve(wsRoot, filePath);
    }

    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document && !editor.document.isUntitled) {
      const editorDir = path.dirname(editor.document.fileName);
      return path.resolve(editorDir, filePath);
    }

    console.warn(
      `[NativeTools] No workspace root found, resolving "${filePath}" relative to process.cwd(): ${process.cwd()}`
    );
    return path.resolve(filePath);
  }

  private resolveDirectoryPath(directoryPath?: string): string {
    const resolved = this.resolveDirectoryPathRaw(directoryPath);
    if (this.workspaceRoot) {
      assertWithinWorkspace(resolved, this.workspaceRoot);
    }
    return resolved;
  }

  private resolveDirectoryPathRaw(directoryPath?: string): string {
    if (!directoryPath) {
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document && !editor.document.isUntitled) {
        return path.dirname(editor.document.fileName);
      }
      const wsRoot = this.workspaceRoot;
      if (wsRoot) {
        return wsRoot;
      }
      console.warn(
        `[NativeTools] No workspace root found, using process.cwd(): ${process.cwd()}`
      );
      return process.cwd();
    }
    return this.resolvePathRaw(directoryPath, true);
  }

  private async detectShell(): Promise<string> {
    if (process.platform === "win32") {
      const gitBashPaths = [
        "C:\\Program Files\\Git\\bin\\bash.exe",
        "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
        process.env.GIT_BASH_PATH,
      ].filter(Boolean) as string[];

      for (const bashPath of gitBashPaths) {
        try {
          await stat(bashPath);
          console.log(`[NativeTools] Using Git Bash: ${bashPath}`);
          return bashPath;
        } catch {
          continue;
        }
      }

      console.log(`[NativeTools] Using cmd.exe (Git Bash not found)`);
      return "cmd.exe";
    }

    return "/bin/bash";
  }

  private async enhanceCommandWithVenv(
    command: string,
    cwd: string,
    shell: string
  ): Promise<string> {
    const pythonTargetRegex =
      /\bpython\d*(\.\d+)?(\s+|$|'|")|\.py(\s+|'|"|$)|pipenv|poetry/i;

    if (!pythonTargetRegex.test(command)) {
      return command;
    }

    const isBash = shell.includes("bash") || shell === "/bin/bash";
    const isCmd = shell === "cmd.exe" || shell.endsWith("cmd.exe");

    const venvPaths = [
      path.join(cwd, "venv"),
      path.join(cwd, ".venv"),
      path.join(cwd, "env"),
      path.join(cwd, ".env"),
    ];

    for (const venvPath of venvPaths) {
      try {
        const stats = await stat(venvPath);
        if (stats.isDirectory()) {
          const activatePath = path.join(venvPath, "bin", "activate");
          const activateWindowsPath = path.join(
            venvPath,
            "Scripts",
            "activate"
          );

          try {
            await stat(activatePath);
            console.log(`[NativeTools] Found venv at ${venvPath}`);
            if (isBash) {
              return `source "${activatePath}" && ${command}`;
            }
          } catch {
            // continue
          }

          try {
            await stat(activateWindowsPath);
            console.log(`[NativeTools] Found venv at ${venvPath}`);
            if (isBash) {
              return `source "${activateWindowsPath}" && ${command}`;
            } else if (isCmd) {
              return `"${activateWindowsPath}" && ${command}`;
            }
            return `source "${activateWindowsPath}" && ${command}`;
          } catch {
            continue;
          }
        }
      } catch {
        continue;
      }
    }

    console.log(
      `[NativeTools] No venv found for Python command, using system Python`
    );
    return command;
  }

  private async executeTerminalCommand(
    command: string,
    workingDirectory?: string
  ): Promise<NativeToolResult> {
    try {
      let cwd = workingDirectory
        ? this.resolvePath(workingDirectory, true)
        : this.resolveDirectoryPath();

      if (cwd.includes(path.sep + ".nimis")) {
        if (this.workspaceRoot) {
          console.log(
            `[NativeTools] Working directory is inside .nimis folder, using workspace root instead: "${this.workspaceRoot}"`
          );
          cwd = this.workspaceRoot;
        } else {
          const workspaceRoot = cwd.split(path.sep + ".nimis")[0];
          console.log(
            `[NativeTools] Working directory is inside .nimis folder, using extracted workspace root: "${workspaceRoot}"`
          );
          cwd = workspaceRoot;
        }
      }

      console.log(
        `[NativeTools] Executing command: "${command}" in directory: "${cwd}"`
      );

      const shell = await this.detectShell();

      const enhancedCommand = await this.enhanceCommandWithVenv(
        command,
        cwd,
        shell
      );

      if (enhancedCommand !== command) {
        console.log(
          `[NativeTools] Enhanced command with venv: "${enhancedCommand}"`
        );
      }

      const execAsync = promisify(exec);

      const timeout = 30000;
      const execPromise = execAsync(enhancedCommand, {
        cwd: cwd,
        shell: shell,
        maxBuffer: 1024 * 1024 * 10,
        timeout: timeout,
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`Command timeout after ${timeout}ms`)),
          timeout
        );
      });

      let stdout: string = "";
      let stderr: string = "";
      let hasError = false;

      try {
        const result = await Promise.race([execPromise, timeoutPromise]);
        stdout = result.stdout || "";
        stderr = result.stderr || "";
        hasError = false;
      } catch (error: any) {
        if (error.code === "ETIMEDOUT" || error.message.includes("timeout")) {
          return {
            content: [
              {
                type: "text",
                text: "timeout",
              },
            ],
            isError: true,
          };
        }

        stdout = error.stdout || "";
        stderr = error.stderr || error.message || "";
        hasError = error.code !== undefined || !stdout;
      }

      let output = "";
      if (stdout) {
        output += stdout.trim();
      }
      if (stderr) {
        if (output) output += "\n\n";
        if (stdout) {
          output += `STDERR:\n${stderr.trim()}`;
        } else {
          output += stderr.trim();
        }
      }
      if (!output) {
        output = "Command executed successfully (no output)";
      }

      const result: NativeToolResult = {
        content: [
          {
            type: "text",
            text: output,
          },
        ],
      };

      if (hasError) {
        result.isError = true;
      }

      return result;
    } catch (error: any) {
      console.error(`[NativeTools] Error executing terminal command:`, error);
      return {
        content: [
          {
            type: "text",
            text: "Error executing command",
          },
        ],
        isError: true,
      };
    }
  }
}
