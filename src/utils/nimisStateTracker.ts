import * as fs from "fs";
import * as path from "path";

export interface ToolCallRecord {
  name: string;
  args?: Record<string, unknown>;
  result?: {
    success: boolean;
    summary?: string; // Brief summary of the result (first 200 chars)
  };
}

export interface RuleAppliedRecord {
  id: string;
}

export interface NimisStateSnapshot {
  problem: string;
  toolsCalled: ToolCallRecord[];
  rulesApplied: RuleAppliedRecord[];
  feedback: string[];
  lastUpdated: string;
  workspaceRoot?: string;
  workingFiles?: Record<string, string>; // filename -> full path
}

/**
 * Tracks conversation state: problem, tools called, rules applied, and user feedback.
 * Used to inject context into prompts so the AI is aware of what has been tried.
 * Optionally persists state to a JSON file in the workspace.
 */
/** Max tool calls per turn; after this we stop and ask for user feedback. */
export const TOOL_CALL_LIMIT_PER_TURN = 6;

export class NimisStateTracker {
  private problem: string = "";
  private toolsCalled: ToolCallRecord[] = [];
  private rulesApplied: RuleAppliedRecord[] = [];
  private feedback: string[] = [];
  private readonly persistPath?: string;
  /** Tool calls in the current turn (reset when user sends a new message). */
  private toolCallsThisTurn: number = 0;
  private workspaceRoot?: string;

  // File context tracking — map of filename -> full path for all accessed files
  private workingFiles: Record<string, string> = {};

  private static readonly LOG_PREFIX = "[NimisStateTracker]";

  constructor(options?: { persistPath?: string; workspaceRoot?: string }) {
    this.persistPath = options?.persistPath;
    this.workspaceRoot = options?.workspaceRoot;
    this._load();
  }

  private _load(): void {
    if (!this.persistPath || !fs.existsSync(this.persistPath)) return;
    try {
      const content = fs.readFileSync(this.persistPath, "utf-8");
      const snapshot: any = JSON.parse(content);

      this.problem = snapshot.problem || "";
      this.toolsCalled = snapshot.toolsCalled || [];
      this.rulesApplied = snapshot.rulesApplied || [];
      this.feedback = snapshot.feedback || [];

      if (!this.workspaceRoot && snapshot.workspaceRoot) {
        this.workspaceRoot = snapshot.workspaceRoot;
      }

      if (snapshot.workingFiles) {
        this.workingFiles = { ...snapshot.workingFiles };
      } else {
        this.workingFiles = {};
      }

      console.debug(
        `${NimisStateTracker.LOG_PREFIX} loaded state from ${this.persistPath}`
      );
    } catch (err) {
      console.warn(`${NimisStateTracker.LOG_PREFIX} failed to load state:`, err);
    }
  }

  private _persist(): void {
    if (!this.persistPath) return;
    try {
      const dir = path.dirname(this.persistPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const snapshot: NimisStateSnapshot = {
        problem: this.problem,
        toolsCalled: [...this.toolsCalled],
        rulesApplied: [...this.rulesApplied],
        feedback: [...this.feedback],
        lastUpdated: new Date().toISOString(),
        workspaceRoot: this.workspaceRoot,
        workingFiles: Object.keys(this.workingFiles).length > 0 ? { ...this.workingFiles } : undefined,
      };
      fs.writeFileSync(
        this.persistPath,
        JSON.stringify(snapshot, null, 2),
        "utf-8"
      );
      console.debug(
        `${NimisStateTracker.LOG_PREFIX} persisted to ${this.persistPath}`
      );
    } catch (err) {
      console.warn(`${NimisStateTracker.LOG_PREFIX} failed to persist:`, err);
    }
  }

  setProblem(p: string): void {
    this.problem = p;
    console.debug(
      `${NimisStateTracker.LOG_PREFIX} setProblem:`,
      p.substring(0, 100) + (p.length > 100 ? "..." : "")
    );
    this._persist();
  }

  /** File context management — remember all accessed files as a map of filename -> full path.
   *  Exclude internal persisted state file (.nimis/state.json).
   */
  setCurrentFile(filePath: string, _content?: string): void {
    try {
      const normalized = path.normalize(filePath);
      const excluded = path.join(".nimis", "state.json");
      if (normalized.endsWith(excluded)) {
        console.debug(
          `${NimisStateTracker.LOG_PREFIX} setCurrentFile ignored (excluded path):`,
          filePath
        );
        return;
      }

      const fileName = path.basename(normalized);
      this.workingFiles[fileName] = normalized;
      console.debug(
        `${NimisStateTracker.LOG_PREFIX} setCurrentFile:`,
        `${fileName} -> ${normalized}`
      );
      this._persist();
    } catch (err) {
      // Fallback: if normalization fails, still attempt to set the path
      console.debug(
        `${NimisStateTracker.LOG_PREFIX} setCurrentFile - normalize failed, using raw path:`,
        filePath,
        err
      );
      const fileName = path.basename(filePath);
      this.workingFiles[fileName] = filePath;
      this._persist();
    }
  }

  /** Clear a specific file by filename, or clear all files if no filename provided. */
  clearCurrentFile(fileName?: string): void {
    if (fileName) {
      delete this.workingFiles[fileName];
      console.debug(`${NimisStateTracker.LOG_PREFIX} clearCurrentFile:`, fileName);
    } else {
      this.workingFiles = {};
      console.debug(`${NimisStateTracker.LOG_PREFIX} clearCurrentFile: all files cleared`);
    }
    this._persist();
  }

  /** Get the full path for a specific file by filename, or undefined if not found. */
  getCurrentFilePath(fileName?: string): string | undefined {
    if (fileName) {
      return this.workingFiles[fileName];
    }
    // For backward compatibility: return the most recently added file (last in object)
    const entries = Object.entries(this.workingFiles);
    return entries.length > 0 ? entries[entries.length - 1][1] : undefined;
  }

  /** Get all working files as a map of filename -> full path. */
  getWorkingFiles(): Readonly<Record<string, string>> {
    return { ...this.workingFiles };
  }

  /** Call when the user sends a new message to reset per-turn tool count. */
  startNewTurn(): void {
    this.toolCallsThisTurn = 0;
  }

  /** True if we have already executed TOOL_CALL_LIMIT_PER_TURN tool calls this turn. */
  hasReachedToolCallLimit(): boolean {
    return this.toolCallsThisTurn >= TOOL_CALL_LIMIT_PER_TURN;
  }

  recordToolCall(
    name: string,
    args?: Record<string, unknown>,
    result?: { success: boolean; summary?: string }
  ): void {
    this.toolsCalled.push({ name, args, result });
    this.toolCallsThisTurn += 1;
    // Only log with status if result is provided (otherwise it will be updated later)
    if (result) {
      const status = result.success ? "✓" : "✗";
      const summary = result.summary
        ? ` - ${result.summary.substring(0, 100)}${result.summary.length > 100 ? "..." : ""}`
        : "";
      console.log(
        `${NimisStateTracker.LOG_PREFIX} [${status}] ${name}${summary}`
      );
    } else {
      console.debug(
        `${NimisStateTracker.LOG_PREFIX} recordToolCall: ${name} (pending)`
      );
    }
    console.debug(
      `${NimisStateTracker.LOG_PREFIX} recordToolCall:`,
      name,
      args ?? {},
      result ?? {}
    );
    this._persist();
  }

  /** Update the result of the last recorded tool call. */
  updateLastToolCallResult(result: { success: boolean; summary?: string }): void {
    if (this.toolsCalled.length > 0) {
      const lastCall = this.toolsCalled[this.toolsCalled.length - 1];
      lastCall.result = result;
      const status = result.success ? "✓" : "✗";
      const summary = result.summary
        ? ` - ${result.summary.substring(0, 100)}${result.summary.length > 100 ? "..." : ""}`
        : "";
      console.log(
        `${NimisStateTracker.LOG_PREFIX} [${status}] ${lastCall.name}${summary}`
      );
      this._persist();
    }
  }

  recordRuleApplied(id: string): void {
    if (!this.rulesApplied.some((r) => r.id === id)) {
      this.rulesApplied.push({ id });
      console.debug(`${NimisStateTracker.LOG_PREFIX} recordRuleApplied:`, id);
      this._persist();
    }
  }

  /** Replace rules-applied list with current applicable rule ids (e.g. each prompt build). */
  setRulesApplied(ids: string[]): void {
    this.rulesApplied = ids.map((id) => ({ id }));
    if (ids.length > 0) {
      console.debug(
        `${NimisStateTracker.LOG_PREFIX} setRulesApplied:`,
        ids.join(", ")
      );
      this._persist();
    }
  }

  recordFeedback(text: string): void {
    this.feedback.push(text);
    console.debug(
      `${NimisStateTracker.LOG_PREFIX} recordFeedback:`,
      text.substring(0, 80) + (text.length > 80 ? "..." : "")
    );
    this._persist();
  }

  reset(): void {
    this.problem = "";
    this.toolsCalled = [];
    this.rulesApplied = [];
    this.feedback = [];
    this.toolCallsThisTurn = 0;
    this.workingFiles = {};
    console.debug(`${NimisStateTracker.LOG_PREFIX} reset`);
    this._persist();
  }

  /** Returns formatted state for injection into the prompt. Empty if nothing tracked. */
  formatForPrompt(): string {
    const parts: string[] = [];

    if (this.workspaceRoot) {
      parts.push(`**Workspace root:** ${this.workspaceRoot}`);
    }

    if (Object.keys(this.workingFiles).length > 0) {
      const fileList = Object.entries(this.workingFiles)
        .map(([fileName, fullPath]) => `  - ${fileName} → ${fullPath}`)
        .join("\n");
      parts.push(
        `**📁 Available Working Files (use these exact paths in tool calls):**\n` +
        `${fileList}\n` +
        `\n⚠️ IMPORTANT: When referencing files, use the FULL PATH shown above. ` +
        `If you need to read/edit a file, use the exact path from this list in your tool calls.`
      );
    }

    if (this.problem) {
      parts.push(`**Problem:** ${this.problem}`);
    }

    if (this.toolsCalled.length > 0) {
      const list = this.toolsCalled
        .map((t) => (t.args ? `${t.name}(${JSON.stringify(t.args)})` : t.name))
        .join(", ");
      parts.push(`**Tools called:** ${list}`);
    }

    if (this.rulesApplied.length > 0) {
      const list = this.rulesApplied.map((r) => r.id).join(", ");
      parts.push(`**Rules applied:** ${list}`);
    }

    if (this.feedback.length > 0) {
      parts.push(`**User feedback:** ${this.feedback.join("; ")}`);
    }

    if (parts.length === 0) return "";

    const formatted =
      "\n\n## Current session state\n" + parts.join("\n\n") + "\n";
    console.debug(`${NimisStateTracker.LOG_PREFIX} formatForPrompt:`, {
      problem: !!this.problem,
      toolsCount: this.toolsCalled.length,
      rulesCount: this.rulesApplied.length,
      feedbackCount: this.feedback.length,
      workingFilesCount: Object.keys(this.workingFiles).length,
    });
    return formatted;
  }

  setWorkspaceRoot(root: string): void {
    this.workspaceRoot = root;
    console.debug(`${NimisStateTracker.LOG_PREFIX} setWorkspaceRoot:`, root);
    this._persist();
  }

  getWorkspaceRoot(): string | undefined {
    return this.workspaceRoot;
  }

  getProblem(): string {
    return this.problem;
  }

  getToolsCalled(): readonly ToolCallRecord[] {
    return this.toolsCalled;
  }

  getRulesApplied(): readonly RuleAppliedRecord[] {
    return this.rulesApplied;
  }

  getFeedback(): readonly string[] {
    return this.feedback;
  }
}
