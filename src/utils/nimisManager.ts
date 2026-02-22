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
      "### How to use **tool_call**\n\n" +
      "## Two XML formats for tool calls\n\n" +
      
      "**FORMAT A: Simple attribute format** (for tools with simple string/number arguments)\n" +
      '<tool_call name="TOOL_NAME" args=\'{ "arg1": "value1", "arg2": 123 }\' />\n\n' +
      
      "**FORMAT B: Child element format with CDATA** (MANDATORY for tools with code/content)\n" +
      '<tool_call name="TOOL_NAME">\n' +
      "  <arg1>simple_value</arg1>\n" +
      "  <content><![CDATA[\n" +
      "    Multi-line code or content\n" +
      "    with \"quotes\" and <brackets>\n" +
      "  ]]></content>\n" +
      "</tool_call>\n\n" +
      
      "## FORMAT SELECTION RULES\n\n" +
      
      "**USE FORMAT B (CDATA) FOR THESE TOOLS:**\n" +
      "✅ **create_file** - Use <content> with CDATA\n" +
      "✅ **edit_file** - Use <old_text> and <new_text> with CDATA\n" +
      "✅ **replace_file** - Use <content> with CDATA\n" +
      "✅ **vim_edit** - Use <commands> with CDATA (each command on its own line)\n" +
      "✅ Any tool that accepts multi-line text, code, or content with special characters\n\n" +
      
      "**USE FORMAT A (ATTRIBUTE) FOR:**\n" +
      "✅ Tools with simple string/number arguments (e.g., read_file, exec_terminal)\n" +
      "✅ When arguments are short and contain no quotes or special characters\n\n" +
      
      "## VIM_EDIT SPECIFIC REQUIREMENTS\n\n" +
      
      "**ALWAYS use FORMAT B with CDATA for vim_edit:**\n" +
      '<tool_call name="vim_edit">\n' +
      "  <file_path>hello.py</file_path>\n" +
      "  <commands><![CDATA[\n" +
      ":e hello.py\n" +
      "i\n" +
      "#!/usr/bin/env python3\n" +
      "def main():\n" +
      "    print(\"Hello, World!\")\n" +
      "if __name__ == \"__main__\":\n" +
      "    main()\n" +
      "\\x1b\n" +
      ":w\n" +
      "]]></commands>\n" +
      "</tool_call>\n\n" +
      
      "**Why CDATA is required for vim_edit:**\n" +
      "- Each command must be a separate array element\n" +
      "- Commands contain quotes, newlines, and special characters\n" +
      "- The escape sequence \\x1b must be preserved exactly\n" +
      "- Indentation in code must be maintained\n\n" +
      
      "## COMMON PITFALLS TO AVOID\n\n" +
      
      "❌ **DON'T use format A for vim_edit:**\n" +
      '<tool_call name="vim_edit" args=\'{ "file_path": "hello.py", "commands": [":e hello.py", "i", "code"] }\' />\n' +
      "   → This WILL corrupt multi-line content and escape sequences!\n\n" +
      
      "❌ **DON'T put commands in a single string:**\n" +
      "<commands>i\\nline1\\nline2</commands>\n" +
      "   → Each command must be on its own line in CDATA\n\n" +
      
      "✅ **DO use CDATA with one command per line:**\n" +
      "<commands><![CDATA[\n" +
      "i\n" +
      "line1\n" +
      "line2\n" +
      "\\x1b\n" +
      ":w\n" +
      "]]></commands>\n\n" +
      
      "## QUICK REFERENCE TABLE\n\n" +
      "| Tool Name | Required Format | Child Elements |\n" +
      "|-----------|----------------|----------------|\n" +
      "| create_file | FORMAT B (CDATA) | file_path, content |\n" +
      "| edit_file | FORMAT B (CDATA) | file_path, old_text, new_text |\n" +
      "| replace_file | FORMAT B (CDATA) | file_path, content |\n" +
      "| **vim_edit** | **FORMAT B (CDATA)** | **file_path (optional), commands** |\n" +
      "| read_file | FORMAT A or B | file_path |\n" +
      "| exec_terminal | FORMAT A or B | command |\n\n" +
      
      "## CDATA RULES SUMMARY\n\n" +
      "- Use `<![CDATA[` and `]]>` to wrap content\n" +
      "- One command per line inside CDATA for vim_edit\n" +
      "- Simple string arguments (file_path) use plain child elements, not CDATA\n" +
      "- Content inside CDATA is preserved exactly — no escaping needed\n\n" +
      
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
   nativeTools.splice(-1);
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
      const templatesPath = path.join(__dirname, "utils", "templates", "vim_templates.xml");
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
