
import { RulesManager, RuleConfig, Rule } from "../rulesManager";
import * as vscode from "vscode";

// ruleServer.ts
// This server handles rule-related logic for the extension.
// It follows the structure of nativeToolServer and mcpToolServer.

export class RuleServer {
  private rulesManager: RulesManager;
  private rules: Rule[] = [];

  constructor() {
    this.rulesManager = new RulesManager();
  }

  async start() {
    console.log('RuleServer started');
    // Load rules from configuration
    const rulesPaths = vscode.workspace.getConfiguration("nimis").get<RuleConfig[]>("rulesPaths", []);
    await this.rulesManager.loadRules(rulesPaths);
    this.rules = this.rulesManager.getAllRules();
    if (this.rules.length > 0) {
      console.log(`[Rules] Available rules: (${this.rules.length})`);
      for (const rule of this.rules) {
        console.log(`- ${rule.id}${rule.description ? ": " + rule.description : ""}`);
      }
    } else {
      console.log("[Rules] No rules loaded.");
    }
  }

  stop() {
    // Implement server stop logic
    console.log('RuleServer stopped');
  }

  getAvailableRules(): Rule[] {
    return this.rules;
  }

  /** Returns the RulesManager for use by NimisManager (prompt building). */
  getRulesManager(): RulesManager {
    return this.rulesManager;
  }

  registerRule(rule: Rule) {
    // Implement rule registration logic
    // (Not implemented in this example)
    console.log('Rule registered:', rule);
  }

  evaluateRule(ruleId: string, context: any) {
    // Implement rule evaluation logic
    console.log('Evaluating rule:', ruleId, context);
    return true;
  }
}

// Optionally, provide a registration function for consistency
export function registerRuleServer(context: any) {
  const ruleServer = new RuleServer();
  ruleServer.start().then(() => {
    if (context && context.subscriptions) {
      context.subscriptions.push({ dispose: () => ruleServer.stop() });
    }
  });
  return ruleServer;
}
