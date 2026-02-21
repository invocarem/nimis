export interface PromptTemplate {
  systemMessage: string;
  userPrefix: string;
  assistantPrefix: string;
  separator: string;
}

import * as fs from "fs";
import * as path from "path";
import { NativeToolsManager } from "./nativeToolManager";
import { VimToolManager } from "./vim";
import { NimisStateTracker } from "./nimisStateTracker";
import { XmlProcessor } from "./xmlProcessor";
import { MCPManager } from "../mcpManager";
import type { Rule } from "../rulesManager";
import type { RulesManager } from "../rulesManager";

export class NimisManager {
  static toolCallHelp(
    nativeToolManager?: NativeToolsManager,
    vimToolManager?: VimToolManager,
    mcpManager?: MCPManager
  ): string {
    return (
      "### How to use **tool_call**\n" +
      'format a: <tool_call name="TOOL_NAME" args=\'{ ... }\' />\n\n' +
      'format b: <tool_call name="TOOL_NAME"><arg1>...</arg1><arg2>...</arg2></tool_call>\n\n' +
      "Notes:\n" +
      "- format a: Use the attributes `name` and `args` exactly.\n" +
      "- format a: The `args` attribute should contain a valid JSON object as a string.\n" +
      '- format a: Use single quotes around the args value if it contains double quotes: args=\'{ "key": "value" }\'\n' +
      "- format a: When calling a tool, output only the `<tool_call>` tag (no extra explanation in the same assistant message).\n" +
      "- format a: Ensure the JSON object in `args` is properly formatted so it can be parsed by the tool extractor.\n\n" +
      "- format b: For create_file, edit_file, and replace_file, you MUST use CDATA format** (avoids escaping issues with code):\n" +
      '<tool_call name="create_file">\n' +
      "<file_path>path/to/file.ts</file_path>\n" +
      "<content><![CDATA[\nfile content here\n]]></content>\n" +
      "</tool_call>\n\n" +
      "CDATA rules:\n" +
      "- Wrap code/text parameters (old_text, new_text, content) in <![CDATA[...]]>\n" +
      "- Simple parameters like file_path, line_start, line_end use plain child elements (no CDATA needed)\n" +
      "- Content inside CDATA is preserved exactly — no escaping needed for quotes, brackets, etc.\n\n" +
      NimisManager.buildToolDocs(nativeToolManager, vimToolManager, mcpManager)
    );
  }

  private static buildToolDocs(
    nativeToolManager?: NativeToolsManager,
    vimToolManager?: VimToolManager,
    mcpManager?: MCPManager
  ): string {
    const manager = nativeToolManager || NativeToolsManager.getInstance();
    const nativeTools = manager.getAvailableTools();
   nativeTools.splice(0, nativeTools.length);
    let doc = "**Available native tools:**\n";
    doc += nativeTools
      .map((tool) => {
        const required =
          tool.inputSchema.required && tool.inputSchema.required.length > 0
            ? ` (required: ${tool.inputSchema.required.join(", ")})`
            : "";
        const params = Object.entries(tool.inputSchema.properties)
          .map(
            ([key, val]: [string, any]) =>
              `    - ${key}: ${val.description || ""}`
          )
          .join("\n");
        return `- ${tool.name}: ${tool.description}${required}\n${params}`;
      })
      .join("\n\n");

    if (vimToolManager) {
      const vimTools = vimToolManager.getAvailableTools();
      if (vimTools.length > 0) {
        doc += "\n\n**Available Vim tools:**\n";
        doc += vimTools
          .map((tool) => {
            const required =
              tool.inputSchema.required && tool.inputSchema.required.length > 0
                ? ` (required: ${tool.inputSchema.required.join(", ")})`
                : "";
            const params = Object.entries(tool.inputSchema.properties)
              .map(
                ([key, val]: [string, any]) =>
                  `    - ${key}: ${val.description || ""}`
              )
              .join("\n");
            return `- ${tool.name}: ${tool.description}${required}\n${params}`;
          })
          .join("\n\n");

        const templates = NimisManager.loadVimTemplates();
        if (templates) {
          doc += "\n\n**Vim tool usage examples:**\n" + templates;
        }
      }
    }

    if (mcpManager) {
      const mcpTools = mcpManager.getAllTools();
      if (mcpTools.length > 0) {
        doc += "\n\n**Available MCP tools:**\n";
        doc += mcpTools
          .map((tool) => {
            const required =
              tool.inputSchema &&
              tool.inputSchema.required &&
              tool.inputSchema.required.length > 0
                ? ` (required: ${tool.inputSchema.required.join(", ")})`
                : "";
            const params =
              tool.inputSchema && tool.inputSchema.properties
                ? Object.entries(tool.inputSchema.properties)
                    .map(
                      ([key, val]: [string, any]) =>
                        `    - ${key}: ${val.description || ""}`
                    )
                    .join("\n")
                : "";
            return `- ${tool.name}: ${tool.description || ""}${required}\n${params}`;
          })
          .join("\n\n");
      }
    }

    return doc;
  }

  private static loadVimTemplates(): string | null {
    try {
      const templatesPath = path.join(__dirname, "templates", "vim_templates.xml");
      return fs.readFileSync(templatesPath, "utf-8");
    } catch (error: any) {
      console.warn(`[NimisManager] Failed to load vim_templates.xml: ${error.message}`);
      return null;
    }
  }

  private static buildDefaultTemplate(
    nativeToolManager?: NativeToolsManager,
    vimToolManager?: VimToolManager,
    mcpManager?: MCPManager
  ): PromptTemplate {
    return {
      systemMessage:
        "You are Nimis, an AI assistant helping engineers with prototyping and problem-solving.\n\n" +
        "## Priniples \n\n" +
        "You restate User's problem in your own words to show understanding. \n\n" +
        "You execute a tool or apply a rule when it is directly related to User's request. \n\n" +
        NimisManager.toolCallHelp(nativeToolManager, vimToolManager, mcpManager) +
        "\n\n" +
        "## Guide on **rule** \n\n" +
        "When rules are provided, apply them only if they are directly relevant to the user's current task; otherwise discard them. Treat rules like tools — do NOT reference or " +
        "apply a rule unless it clearly helps solve the current request.\n\n",
      userPrefix: "User:",
      assistantPrefix: "Assistant:",
      separator: "\n\n",
    };
  }

  private _buildSystemMessage(): string {
    const base = NimisManager.buildDefaultTemplate(
      this.nativeToolManager,
      this.vimToolManager,
      this.mcpManager
    );
    return base.systemMessage;
  }

  private currentTemplate: PromptTemplate;
  private rules: Rule[] = [];
  private rulesManager?: RulesManager;
  private nativeToolManager?: NativeToolsManager;
  private vimToolManager?: VimToolManager;
  private mcpManager?: MCPManager;
  private stateTracker: NimisStateTracker;

  constructor(options?: {
    template?: Partial<PromptTemplate>;
    rules?: Rule[];
    rulesManager?: RulesManager;
    nativeToolManager?: NativeToolsManager;
    vimToolManager?: VimToolManager;
    mcpManager?: MCPManager;
    stateTracker?: NimisStateTracker;
    workspaceRoot?: string;
  }) {
    this.rules = options?.rules || [];
    this.rulesManager = options?.rulesManager;
    this.nativeToolManager = options?.nativeToolManager;
    this.vimToolManager = options?.vimToolManager;
    this.mcpManager = options?.mcpManager;
    const nimisDir = options?.workspaceRoot
      ? path.join(options.workspaceRoot, ".nimis")
      : undefined;
    const persistPath = nimisDir
      ? path.join(nimisDir, "state.json")
      : undefined;
    this.stateTracker =
      options?.stateTracker ?? new NimisStateTracker({ persistPath, workspaceRoot: options?.workspaceRoot });
    if (nimisDir) {
      XmlProcessor.setLogDir(nimisDir);
    }
    this.currentTemplate = {
      ...NimisManager.buildDefaultTemplate(
        this.nativeToolManager,
        this.vimToolManager,
        this.mcpManager
      ),
      ...options?.template,
    };
  }

  /**
   * Get the state tracker for recording problem, tool calls, and feedback.
   */
  getStateTracker(): NimisStateTracker {
    return this.stateTracker;
  }

  /**
   * Set rules and update the template system message
   */
  setRules(rules: Rule[]): void {
    this.rules = rules;
    this.currentTemplate.systemMessage = NimisManager.buildDefaultTemplate(
      this.nativeToolManager,
      this.vimToolManager,
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

    // Inject relevant rules for the conversation
    if (this.rulesManager) {
      const applicableRules =
        this.rulesManager.getApplicableRulesFromHistory(conversationHistory);
      this.stateTracker.setRulesApplied(applicableRules.map((r) => r.id));
      const formattedRules =
        this.rulesManager.formatRulesForPrompt(applicableRules);
      if (formattedRules && formattedRules.trim().length > 0) {
        prompt += formattedRules;
      }
    }

    // Inject session state if tracked
    const stateText = this.stateTracker.formatForPrompt();
    if (stateText) {
      prompt += stateText;
    }

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
    this.currentTemplate = {
      ...NimisManager.buildDefaultTemplate(
        this.nativeToolManager,
        this.vimToolManager,
        this.mcpManager
      ),
    };
  }
}
