export interface PromptTemplate {
  systemMessage: string;
  userPrefix: string;
  assistantPrefix: string;
  separator: string;
}


import { NativeToolsManager } from "./nativeToolManager";
import { MCPManager } from "../mcpManager";
import type { Rule } from "../rulesManager";
import type { RulesManager } from "../rulesManager";

export class NimisManager {
    /**
     * Returns help text for tool_call usage, including examples and available tools.
     */
    static toolCallHelp(nativeToolManager?: NativeToolsManager, mcpManager?: MCPManager): string {
      return (
        "### How to use tool_call\n" +
        "IMPORTANT: do NOT use the model's built-in function-calling API or any other tool-call format.\n" +
        "You MUST use the exact textual syntax shown below when invoking a tool. The assistant's response should contain the literal `tool_call(...)` expression (preferably on its own line) and must NOT rely on model-level function calls.\n\n" +
        "tool_call(name=\"TOOL_NAME\", arguments={ ... })\n\n" +
        "Example (exact):\n" +
        "tool_call(name=\"read_file\", arguments={ \"file_path\": \"src/index.ts\" })\n\n" +
        "Notes:\n" +
        "- Use the keys `name` (or `tool_name`) and `arguments` (or `args`) exactly.\n" +
        "- When calling a tool, output only the `tool_call(...)` expression (no extra explanation in the same assistant message).\n" +
        "- Ensure the `arguments` object is valid JSON-like so it can be parsed by the tool extractor.\n\n" +
        NimisManager.buildToolDocs(nativeToolManager, mcpManager)
      );
    }

  private static buildToolDocs(nativeToolManager?: NativeToolsManager, mcpManager?: MCPManager): string {
    const manager = nativeToolManager || new NativeToolsManager();
    const nativeTools = manager.getAvailableTools();
    let doc = "**Available native tools:**\n";
    doc += nativeTools.map(tool => `- ${tool.name}: ${tool.description}`).join("\n");

    if (mcpManager) {
      const mcpTools = mcpManager.getAllTools();
      if (mcpTools.length > 0) {
        doc += "\n\n**Available MCP tools:**\n";
        doc += mcpTools.map(tool => `- ${tool.name}: ${tool.description || ''}`).join("\n");
      }
    }
    return doc;
  }



  private static buildDefaultTemplate(
    rulesText: string,
    nativeToolManager?: NativeToolsManager,
    mcpManager?: MCPManager
  ): PromptTemplate {
    return {
      systemMessage:
        "Your name is **Nimis**. You are a helpful AI assistant. You provide prototyping help to engineers, assisting them in problem solving.\n\n" +
        "When rules are provided, apply them only if they are directly relevant to the user's current task; otherwise discard them. Treat rules like tools — do NOT reference or " +
        "apply a rule unless it clearly helps solve the current request.\n\n" +
        NimisManager.toolCallHelp(nativeToolManager, mcpManager) + "\n\n" +
        rulesText + "\n\n",
      userPrefix: "User:",
      assistantPrefix: "Assistant:",
      separator: "\n\n",
    };
  }

  private _buildSystemMessage(): string {
    const rulesText = this.rulesManager
      ? this.rulesManager.formatRulesForPrompt(this.rulesManager.getAllRules())
      : "";
    const base = NimisManager.buildDefaultTemplate(
      rulesText,
      this.nativeToolManager,
      this.mcpManager
    );
    return base.systemMessage;
  }

  private currentTemplate: PromptTemplate;
  private rules: Rule[] = [];
  private rulesManager?: RulesManager;
  private nativeToolManager?: NativeToolsManager;
  private mcpManager?: MCPManager;

  constructor(options?: {
    template?: Partial<PromptTemplate>;
    rules?: Rule[];
    rulesManager?: RulesManager;
    nativeToolManager?: NativeToolsManager;
    mcpManager?: MCPManager;
  }) {
    this.rules = options?.rules || [];
    this.rulesManager = options?.rulesManager;
    this.nativeToolManager = options?.nativeToolManager;
    this.mcpManager = options?.mcpManager;
    const rulesText = this.rulesManager
      ? this.rulesManager.formatRulesForPrompt(this.rulesManager.getAllRules())
      : (this.rules.length > 0 ? this.rules.map(r => `## Rule: ${r.id}\n${r.content}`).join("\n\n") : "");
    this.currentTemplate = {
      ...NimisManager.buildDefaultTemplate(
        rulesText,
        this.nativeToolManager,
        this.mcpManager
      ),
      ...options?.template,
    };
  }

  /**
   * Set rules and update the template system message
   */
  setRules(rules: Rule[]): void {
    this.rules = rules;
    const rulesText = this.rulesManager
      ? this.rulesManager.formatRulesForPrompt(this.rulesManager.getAllRules())
      : (this.rules.length > 0 ? this.rules.map(r => `## Rule: ${r.id}\n${r.content}`).join("\n\n") : "");
    this.currentTemplate.systemMessage = NimisManager.buildDefaultTemplate(
      rulesText,
      this.nativeToolManager,
      this.mcpManager
    ).systemMessage;
  }


  /**
   * Build a conversation prompt from message history
   */
  buildConversationPrompt(
    conversationHistory: Array<{
      role: "user" | "assistant" | "system";
      content: string;
    }>
  ): string {
    // Build system message with current tool docs (incl. MCP tools that may have connected after init)
    let prompt = this._buildSystemMessage();

    for (const msg of conversationHistory) {
      if (msg.role === "user") {
        prompt += `${this.currentTemplate.userPrefix} ${msg.content}${this.currentTemplate.separator}`;
      } else if (msg.role === "assistant") {
        prompt += `${this.currentTemplate.assistantPrefix} ${msg.content}${this.currentTemplate.separator}`;
      } else if (msg.role === "system") {
        prompt += `${msg.content}${this.currentTemplate.separator}`;
      }
    }

    prompt += `${this.currentTemplate.assistantPrefix} `;
    return prompt;
  }

  /**
   * Generate an explanation prompt for code
   */
  buildExplanationPrompt(code: string): string {
    return `Please explain this code:\n\n\`\`\`\n${code}\n\`\`\``;
  }

  /**
   * Update the prompt template
   */
  updateTemplate(template: Partial<PromptTemplate>): void {
    this.currentTemplate = { ...this.currentTemplate, ...template };
  }

  /**
   * Get the current template
   */
  getTemplate(): PromptTemplate {
    return { ...this.currentTemplate };
  }

  /**
   * Reset to default template
   */
  resetToDefault(): void {
    const rulesText = this.rulesManager
      ? this.rulesManager.formatRulesForPrompt(this.rulesManager.getAllRules())
      : (this.rules.length > 0 ? this.rules.map(r => `## Rule: ${r.id}\n${r.content}`).join("\n\n") : "");
    this.currentTemplate = {
      ...NimisManager.buildDefaultTemplate(
        rulesText,
        this.nativeToolManager,
        this.mcpManager
      ),
    };
  }
}