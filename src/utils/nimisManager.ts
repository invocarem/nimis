export interface PromptTemplate {
  systemMessage: string;
  userPrefix: string;
  assistantPrefix: string;
  separator: string;
}

import * as path from "path";
import { NativeToolsManager } from "./nativeToolManager";
import { NimisStateTracker } from "./nimisStateTracker";
import { XmlProcessor } from "./xmlProcessor";
import { MCPManager } from "../mcpManager";
import type { Rule } from "../rulesManager";
import type { RulesManager } from "../rulesManager";

export class NimisManager {
  /**
   * Returns help text for tool_call usage, including examples and available tools.
   */
  static forceToolCallHelp(
    nativeToolManager?: NativeToolsManager,
    mcpManager?: MCPManager
  ): string {
    return (
      "### How to invoke tool_call\n" +
      "IMPORTANT: do NOT use the model's built-in function-calling API or any other tool-call format.\n" +
      "You MUST use the exact XML syntax shown below when invoking a tool. The assistant's response should contain the literal XML tag (preferably on its own line) and must NOT rely on model-level function calls.\n\n" +
      'Simple format: <tool_call name="TOOL_NAME" args=\'{ ... }\' />\n\n' +
      "Example (exact):\n" +
      '<tool_call name="read_file" args=\'{ "file_path": "c:/code/__foo__/src/index.ts" }\' />\n' +
      "Notes:\n" +
      "- Use the attributes `name` and `args` exactly.\n" +
      "- The `args` attribute should contain a valid JSON object as a string.\n" +
      '- Use single quotes around the args value if it contains double quotes: args=\'{ "key": "value" }\'\n' +
      "- When calling a tool, output only the `<tool_call>` tag (no extra explanation in the same assistant message).\n" +
      "- Ensure the JSON object in `args` is properly formatted so it can be parsed by the tool extractor.\n\n" +
      "**For edit_lines, create_file, and replace_file, you MUST use CDATA format** (avoids escaping issues with code):\n" +
      '<tool_call name="edit_lines">\n' +
      "<file_path>path/to/file.ts</file_path>\n" +
      "<line_start>10</line_start>\n" +
      "<line_end>12</line_end>\n" +
      "<new_text><![CDATA[\nreplacement text\n]]></new_text>\n" +
      "</tool_call>\n\n" +
      '<tool_call name="create_file">\n' +
      "<file_path>path/to/file.ts</file_path>\n" +
      "<content><![CDATA[\nfile content here\n]]></content>\n" +
      "</tool_call>\n\n" +
      "CDATA rules:\n" +
      "- Wrap code/text parameters (old_text, new_text, content) in <![CDATA[...]]>\n" +
      "- Simple parameters like file_path, line_start, line_end use plain child elements (no CDATA needed)\n" +
      "- Content inside CDATA is preserved exactly — no escaping needed for quotes, brackets, etc.\n\n" +
      NimisManager.buildToolDocs(nativeToolManager, mcpManager)
    );
  }
  static toolCallHelp(
    nativeToolManager?: NativeToolsManager,
    mcpManager?: MCPManager
  ): string {
    return (
      "### How to use **tool_call**\n" +
      'Simple format: <tool_call name="TOOL_NAME" args=\'{ ... }\' />\n\n' +
      "Notes:\n" +
      "- Use the attributes `name` and `args` exactly.\n" +
      "- The `args` attribute should contain a valid JSON object as a string.\n" +
      '- Use single quotes around the args value if it contains double quotes: args=\'{ "key": "value" }\'\n' +
      "- When calling a tool, output only the `<tool_call>` tag (no extra explanation in the same assistant message).\n" +
      "- Ensure the JSON object in `args` is properly formatted so it can be parsed by the tool extractor.\n\n" +
      "**For  edit_lines, create_file, and replace_file, you MUST use CDATA format** (avoids escaping issues with code):\n" +
     '<tool_call name="edit_lines">\n' +
      "<file_path>path/to/file.ts</file_path>\n" +
      "<line_start>10</line_start>\n" +
      "<line_end>12</line_end>\n" +
      "<new_text><![CDATA[\nreplacement text\n]]></new_text>\n" +
      "</tool_call>\n\n" +
      '<tool_call name="create_file">\n' +
      "<file_path>path/to/file.ts</file_path>\n" +
      "<content><![CDATA[\nfile content here\n]]></content>\n" +
      "</tool_call>\n\n" +
      "CDATA rules:\n" +
      "- Wrap code/text parameters (old_text, new_text, content) in <![CDATA[...]]>\n" +
      "- Simple parameters like file_path, line_start, line_end use plain child elements (no CDATA needed)\n" +
      "- Content inside CDATA is preserved exactly — no escaping needed for quotes, brackets, etc.\n\n" +
      NimisManager.buildToolDocs(nativeToolManager, mcpManager)
    );
  }

  private static buildToolDocs(
    nativeToolManager?: NativeToolsManager,
    mcpManager?: MCPManager
  ): string {
    const manager = nativeToolManager || NativeToolsManager.getInstance();
    const nativeTools = manager.getAvailableTools();
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
    //console.log("Generated tool documentation for prompt:\n", doc);
    return doc;
  }

  private static buildDefaultTemplate(
    nativeToolManager?: NativeToolsManager,
    mcpManager?: MCPManager
  ): PromptTemplate {
    return {
      systemMessage:
        "You are Nimis, an AI assistant helping engineers with prototyping and problem-solving.\n\n" +
        "## Priniples \n\n" +
        "You restate User's problem in your own words to show understanding. \n\n" +
        "You execute a tool or apply a rule when it is directly related to User's request. \n\n" +
        NimisManager.toolCallHelp(nativeToolManager, mcpManager) +
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
      this.mcpManager
    );
    return base.systemMessage;
  }

  private currentTemplate: PromptTemplate;
  private rules: Rule[] = [];
  private rulesManager?: RulesManager;
  private nativeToolManager?: NativeToolsManager;
  private mcpManager?: MCPManager;
  private stateTracker: NimisStateTracker;

  constructor(options?: {
    template?: Partial<PromptTemplate>;
    rules?: Rule[];
    rulesManager?: RulesManager;
    nativeToolManager?: NativeToolsManager;
    mcpManager?: MCPManager;
    stateTracker?: NimisStateTracker;
    workspaceRoot?: string;
  }) {
    this.rules = options?.rules || [];
    this.rulesManager = options?.rulesManager;
    this.nativeToolManager = options?.nativeToolManager;
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
        this.mcpManager
      ),
    };
  }
}
