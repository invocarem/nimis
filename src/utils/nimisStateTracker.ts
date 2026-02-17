import * as fs from "fs";
import * as path from "path";

export interface ToolCallRecord {
  name: string;
  args?: Record<string, unknown>;
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

  private static readonly LOG_PREFIX = "[NimisStateTracker]";

  constructor(options?: { persistPath?: string }) {
    this.persistPath = options?.persistPath;
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

  /** Call when the user sends a new message to reset per-turn tool count. */
  startNewTurn(): void {
    this.toolCallsThisTurn = 0;
  }

  /** True if we have already executed TOOL_CALL_LIMIT_PER_TURN tool calls this turn. */
  hasReachedToolCallLimit(): boolean {
    return this.toolCallsThisTurn >= TOOL_CALL_LIMIT_PER_TURN;
  }

  recordToolCall(name: string, args?: Record<string, unknown>): void {
    this.toolsCalled.push({ name, args });
    this.toolCallsThisTurn += 1;
    console.debug(
      `${NimisStateTracker.LOG_PREFIX} recordToolCall:`,
      name,
      args ?? {}
    );
    this._persist();
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
    console.debug(`${NimisStateTracker.LOG_PREFIX} reset`);
    this._persist();
  }

  /** Returns formatted state for injection into the prompt. Empty if nothing tracked. */
  formatForPrompt(): string {
    const parts: string[] = [];

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
      "\n\n## Current session state\n" + parts.join("\n") + "\n";
    console.debug(`${NimisStateTracker.LOG_PREFIX} formatForPrompt:`, {
      problem: !!this.problem,
      toolsCount: this.toolsCalled.length,
      rulesCount: this.rulesApplied.length,
      feedbackCount: this.feedback.length,
    });
    return formatted;
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
