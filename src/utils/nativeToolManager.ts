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

export interface TerminalRunStartedEvent {
  command: string;
  workingDirectory: string;
  shell: string;
  startedAt: number;
}

export interface TerminalRunOutputEvent {
  stream: "stdout" | "stderr" | "system";
  chunk: string;
  timestamp: number;
}

export interface TerminalRunFinishedEvent {
  status: "success" | "error" | "timeout";
  durationMs: number;
  summary?: string;
}

export interface TerminalRunObserver {
  onStarted?: (event: TerminalRunStartedEvent) => void;
  onOutput?: (event: TerminalRunOutputEvent) => void;
  onFinished?: (event: TerminalRunFinishedEvent) => void;
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
    workingDirectory?: string,
    observer?: TerminalRunObserver
  ): Promise<NativeToolResult> {
    return this.executeTerminalCommand(command, workingDirectory, observer);
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
      const wsRoot = this.workspaceRoot;
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
  ): Promise<{
    command: string;
    venvDirName?: "venv" | ".venv" | "env" | ".env";
    activationKind?: "Scripts" | "bin";
  }> {
    // Only wrap python-like invocations.
    const pythonTargetRegex =
      /\bpython\d*(\.\d+)?(\s+|$|'|")|\.py(\s+|$|'|"|$)|pipenv|poetry/i;

    if (!pythonTargetRegex.test(command)) {
      return { command };
    }

    const isBash = shell.includes("bash") || shell === "/bin/bash";
    const isCmd = shell === "cmd.exe" || shell.endsWith("cmd.exe");
    const alreadyTargetsVenvPython =
      /(^|\s|["'])[^"'\s]*[\\/](?:venv|\.venv|env|\.env)[\\/](?:scripts|bin)[\\/](?:python(?:\.exe)?|python\d+(?:\.\d+)?(?:\.exe)?)(?=\s|$|["'])/i.test(
        command
      );

    if (alreadyTargetsVenvPython) {
      return { command };
    }

    // Requirement: check current folder for a venv.
    const venvDirCandidates: Array<"venv" | ".venv" | "env" | ".env"> = [
      "venv",
      ".venv",
      "env",
      ".env",
    ];

    for (const venvDirName of venvDirCandidates) {
      const venvPath = path.join(cwd, venvDirName);
      try {
        const stats = await stat(venvPath);
        if (!stats.isDirectory()) continue;

        const activateScriptsPath = path.join(
          venvPath,
          "Scripts",
          "activate"
        );
        const activateBinPath = path.join(venvPath, "bin", "activate");

        if (isBash) {
          // Windows+Git-Bash: `source ./venv/Scripts/activate`
          try {
            await stat(activateScriptsPath);
            const src = `source "./${venvDirName}/Scripts/activate"`;
            return {
              command: `${src} && ${command}`,
              venvDirName,
              activationKind: "Scripts",
            };
          } catch {
            // continue to bin/activate
          }

          // Linux: `source ./venv/bin/activate`
          try {
            await stat(activateBinPath);
            const src = `source "./${venvDirName}/bin/activate"`;
            return {
              command: `${src} && ${command}`,
              venvDirName,
              activationKind: "bin",
            };
          } catch {
            // continue searching other venv names
          }

          continue;
        }

        if (isCmd) {
          const activateBat = path.join(venvPath, "Scripts", "activate.bat");
          try {
            await stat(activateBat);
            // cmd.exe activation for completeness; not the focus of the requirement
            return {
              command: `call "${activateBat}" && ${command}`,
              venvDirName,
            };
          } catch {
            // fall back: no activation
          }
        }
      } catch {
        continue;
      }
    }

    console.log(
      `[NativeTools] No venv found for Python command (checked ${cwd}), using system Python`
    );
    return { command };
  }

  private isVenvActivationError(stderr: string, rawErrorMessage: string): boolean {
    const combined = `${stderr}\n${rawErrorMessage}`.toLowerCase();
    // Retry only for activation failures, not for the python process exit code.
    return (
      (combined.includes("source") || combined.includes("activate")) &&
      (combined.includes("no such file") ||
        combined.includes("not found") ||
        combined.includes("cannot open") ||
        combined.includes("permission denied"))
    );
  }

  private toBashPath(inputPath: string): string {
    const normalizedPath = inputPath.replace(/\\/g, "/");
    const driveMatch = normalizedPath.match(/^([A-Za-z]):\/(.*)$/);
    if (!driveMatch) {
      return normalizedPath;
    }

    const drive = driveMatch[1].toLowerCase();
    const rest = driveMatch[2];
    return `/${drive}/${rest}`;
  }

  /**
   * Prefer `source "./venv/Scripts/activate"` under cwd (matches manual Git Bash).
   * Never force MSYS absolute `/c/...` paths for Git Bash; relative `..` paths are acceptable.
   */
  private bashSourceActivateFragment(cwd: string, activateFile: string): string {
    const rel = path.relative(cwd, activateFile);
    const posixRel = rel.split(path.sep).join("/");
    if (!path.isAbsolute(rel)) {
      if (posixRel.startsWith("../") || posixRel === "..") {
        return `source "${posixRel}"`;
      }
      return `source "./${posixRel}"`;
    }
    return `source "${this.toBashPath(activateFile)}"`;
  }

  private commandTargetsPython(command: string): boolean {
    return /\bpython\d*(\.\d+)?(\s+|$|'|")|\.py(\s+|'|"|$)|pipenv|poetry/i.test(
      command
    );
  }

  private isGitBashShell(shell: string): boolean {
    if (!shell) {
      return false;
    }
    return shell.toLowerCase().includes("bash");
  }

  private async runSingleExec(
    enhancedCommand: string,
    cwd: string,
    shell: string,
    timeout: number
  ): Promise<{
    timedOut: boolean;
    stdout: string;
    stderr: string;
    hasError: boolean;
    rawErrorMessage: string;
  }> {
    const execAsync = promisify(exec);
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
    try {
      const result = await Promise.race([execPromise, timeoutPromise]);
      return {
        timedOut: false,
        stdout: result.stdout || "",
        stderr: result.stderr || "",
        hasError: false,
        rawErrorMessage: "",
      };
    } catch (error: any) {
      if (error.code === "ETIMEDOUT" || error.message.includes("timeout")) {
        return {
          timedOut: true,
          stdout: "",
          stderr: "",
          hasError: true,
          rawErrorMessage: error.message || "",
        };
      }
      const stdout = error.stdout || "";
      const stderr = error.stderr || error.message || "";
      const rawErrorMessage = error.message || "";
      const hasError = error.code !== undefined || !stdout;
      return {
        timedOut: false,
        stdout,
        stderr,
        hasError,
        rawErrorMessage,
      };
    }
  }

  private async executeTerminalCommand(
    command: string,
    workingDirectory?: string,
    observer?: TerminalRunObserver
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
      const startedAt = Date.now();
      observer?.onStarted?.({
        command,
        workingDirectory: cwd,
        shell,
        startedAt,
      });

      const timeout = 30000;
      let activeShell = shell;
      const pythonVenvPlan = await this.enhanceCommandWithVenv(
        command,
        cwd,
        activeShell
      );

      const enhancedCommand = pythonVenvPlan.command;
      let venvStatusBlock: string | undefined;
      let activationSourceCommand: string | undefined;

      if (this.commandTargetsPython(command)) {
        const hasVenv = !!pythonVenvPlan.venvDirName;
        const venvDirLabel = pythonVenvPlan.venvDirName || "venv";
        observer?.onOutput?.({
          stream: "system",
          chunk: `1) check current folder for ./venv (cwd: ${cwd}): ${
            hasVenv ? "FOUND" : "MISSING"
          }`,
          timestamp: Date.now(),
        });

        if (hasVenv && pythonVenvPlan.activationKind) {
          activationSourceCommand =
            pythonVenvPlan.activationKind === "Scripts"
              ? `./${pythonVenvPlan.venvDirName}/Scripts/activate`
              : `./${pythonVenvPlan.venvDirName}/bin/activate`;
          const activate = activationSourceCommand;
          observer?.onOutput?.({
            stream: "system",
            chunk: `2) venv is good; run: source "${activate}"`,
            timestamp: Date.now(),
          });
        } else {
          observer?.onOutput?.({
            stream: "system",
            chunk:
              "2) venv not found (or no activate script); running python without activation",
            timestamp: Date.now(),
          });
        }

        observer?.onOutput?.({
          stream: "system",
          chunk: `3) execute: ${command}`,
          timestamp: Date.now(),
        });

        // Also include these steps in the *returned* tool output so the LLM
        // can tell "activation/terminal setup" vs "python/script failure".
        const step1 = `1) check current folder for ./venv (cwd: ${cwd}): ${
          hasVenv ? `FOUND (using ./${venvDirLabel})` : "MISSING"
        }`;
        const step2 = activationSourceCommand
          ? `2) venv is good; run: source "${activationSourceCommand}"`
          : `2) venv not found (or no activate script); running python without activation`;
        const step3 = `3) execute: ${command}`;
        venvStatusBlock = [step1, step2, step3].join("\n");
      }

      if (enhancedCommand !== command) {
        console.log(
          `[NativeTools] Enhanced command with venv: "${enhancedCommand}"`
        );
      }

      let run = await this.runSingleExec(
        enhancedCommand,
        cwd,
        activeShell,
        timeout
      );

      if (run.timedOut) {
        const timeoutAt = Date.now();
        observer?.onOutput?.({
          stream: "system",
          chunk: `Command timeout after ${timeout}ms`,
          timestamp: timeoutAt,
        });
        observer?.onFinished?.({
          status: "timeout",
          durationMs: timeoutAt - startedAt,
          summary: "Command timed out",
        });
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

      let stdout = run.stdout;
      let stderr = run.stderr;
      let hasError = run.hasError;
      let rawErrorMessage = run.rawErrorMessage;

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

      if (venvStatusBlock) {
        // Prefix so callers/LLM always see venv activation context.
        // Keep it out of `enhanceTerminalErrorOutput` parsing where possible.
        output = `${venvStatusBlock}\n\n${output}`;
      }

      const outputTimestamp = Date.now();
      if (stdout) {
        observer?.onOutput?.({
          stream: "stdout",
          chunk: stdout.trim(),
          timestamp: outputTimestamp,
        });
      }
      if (stderr) {
        observer?.onOutput?.({
          stream: "stderr",
          chunk: stderr.trim(),
          timestamp: outputTimestamp,
        });
      }

      if (hasError) {
        if (this.commandTargetsPython(command) && activationSourceCommand) {
          const activationFailed = this.isVenvActivationError(
            stderr,
            rawErrorMessage
          );
          if (activationFailed) {
            output =
              output +
              `\n\nClassification: VENV activation failed (so python likely didn't run under venv).`;
          } else {
            output =
              output +
              `\n\nClassification: Python command ran (or attempted) but returned non-zero; treat as script/command failure.`;
          }
        }
        output = await this.enhanceTerminalErrorOutput(
          output,
          command,
          cwd,
          activeShell,
          rawErrorMessage
        );
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

      observer?.onFinished?.({
        status: hasError ? "error" : "success",
        durationMs: Date.now() - startedAt,
        summary: output,
      });

      return result;
    } catch (error: any) {
      console.error(`[NativeTools] Error executing terminal command:`, error);
      observer?.onOutput?.({
        stream: "system",
        chunk: "Error executing command",
        timestamp: Date.now(),
      });
      observer?.onFinished?.({
        status: "error",
        durationMs: 0,
        summary: "Error executing command",
      });
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

  private async enhanceTerminalErrorOutput(
    currentOutput: string,
    command: string,
    cwd: string,
    shell: string,
    rawErrorMessage: string
  ): Promise<string> {
    const details: string[] = [];
    const lowerOutput = currentOutput.toLowerCase();
    const isGenericFailure =
      lowerOutput.startsWith("command failed:") ||
      (rawErrorMessage.toLowerCase().startsWith("command failed:") &&
        !lowerOutput.includes("stderr:"));

    if (isGenericFailure) {
      details.push(`Working directory: ${cwd}`);
      details.push(`Shell: ${shell}`);
      const exitCodeMatch = rawErrorMessage.match(/(?:code|exit code)\s*[:=]?\s*(\d+)/i);
      if (exitCodeMatch?.[1]) {
        details.push(`Exit code: ${exitCodeMatch[1]}`);
      }
    }

    const pythonScriptMatch = command.match(
      /\bpython\d*(?:\.\d+)?\s+["']?([^"'\s]+\.py)\b/i
    );
    if (pythonScriptMatch) {
      const scriptPath = pythonScriptMatch[1];
      const resolvedScriptPath = path.isAbsolute(scriptPath)
        ? scriptPath
        : path.resolve(cwd, scriptPath);
      let scriptExists = true;
      try {
        await stat(resolvedScriptPath);
      } catch {
        scriptExists = false;
        details.push(`Python script not found: ${resolvedScriptPath}`);
        details.push(
          "Tip: set working_directory to the script folder or use an absolute script path."
        );
      }
      if (scriptExists) {
        details.push(`Python script found: ${resolvedScriptPath}`);
      }
    }

    if (isGenericFailure && /\bpython\d*(?:\.\d+)?\b/i.test(command)) {
      const pythonProbe = await this.probePythonEnvironment(cwd, shell);
      if (pythonProbe.executable) {
        details.push(`Python executable: ${pythonProbe.executable}`);
      }
      if (pythonProbe.version) {
        details.push(`Python version: ${pythonProbe.version}`);
      }
      if (pythonProbe.error) {
        details.push(`Python probe error: ${pythonProbe.error}`);
      }
    }

    if (details.length === 0) {
      return currentOutput;
    }

    return `${currentOutput}\n\nDiagnostics:\n${details.map((d) => `- ${d}`).join("\n")}`;
  }

  private async probePythonEnvironment(
    cwd: string,
    shell: string
  ): Promise<{ executable?: string; version?: string; error?: string }> {
    try {
      const execAsync = promisify(exec);
      const probeCommand =
        'python -c "import sys; print(sys.executable); print(sys.version.splitlines()[0])"';
      const result = await execAsync(probeCommand, {
        cwd,
        shell,
        timeout: 8000,
        maxBuffer: 1024 * 256,
      });
      const lines = (result.stdout || "")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      return {
        executable: lines[0],
        version: lines[1],
      };
    } catch (e: any) {
      return {
        error: e?.message || "Unable to probe python environment",
      };
    }
  }
}
