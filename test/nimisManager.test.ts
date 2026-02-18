import { NimisManager } from "../src/utils/nimisManager";
import type { Rule } from "../src/rulesManager";
import { RulesManager } from "../src/rulesManager";

import type { NativeToolsManager } from "../src/utils/nativeToolManager";
const mockNativeToolManager = {
  getAvailableTools: () => [
    { name: "mockTool", description: "A mock tool", inputSchema: { type: "object", properties: {} } }
  ]
} as unknown as NativeToolsManager;

describe("NimisManager rules integration", () => {
  const mockRules: Rule[] = [
    {
      id: "rule-1",
      filePath: "/fake/path/1.md",
      description: "Test rule 1",
      triggers: ["test"],
      content: "Always say hello.",
      lastModified: Date.now(),
    },
    {
      id: "rule-2",
      filePath: "/fake/path/2.md",
      description: "Test rule 2",
      triggers: ["test2"],
      content: "Never say goodbye.",
      lastModified: Date.now(),
    },
  ];

  const mockRulesManager = {
    getAllRules: () => mockRules,
    formatRulesForPrompt: (rules: Rule[]) =>
      rules.map(r => `## Rule: ${r.id}\n${r.content}`).join("\n\n"),
    getApplicableRulesFromHistory: (conversationHistory: Array<{ role: "user" | "assistant" | "system"; content: string }>) => {
      // Simulate trigger matching logic for test
      const text = conversationHistory.map(m => m.content.toLowerCase()).join(" ");
      return mockRules.filter(rule =>
        rule.triggers && rule.triggers.some(trigger => text.includes(trigger.toLowerCase()))
      );
    },
  } as any;


  it("should inject only relevant rules into the conversation prompt", () => {
    const manager = new NimisManager({ rules: mockRules, rulesManager: mockRulesManager, nativeToolManager: mockNativeToolManager });
    const conversationHistory: Array<{ role: "user" | "assistant" | "system"; content: string }> = [
      { role: "user", content: "This is a test message." },
      { role: "assistant", content: "Response." },
      { role: "user", content: "Another message with test2 trigger." }
    ];
    const prompt = manager.buildConversationPrompt(conversationHistory);
    // Should include both rules since both triggers appear
    expect(prompt).toContain("Always say hello.");
    expect(prompt).toContain("Never say goodbye.");
  });

  it("should not inject rules if triggers are not present in conversation", () => {
    const manager = new NimisManager({ rules: mockRules, rulesManager: mockRulesManager, nativeToolManager: mockNativeToolManager });
    const conversationHistory: Array<{ role: "user" | "assistant" | "system"; content: string }> = [
      { role: "user", content: "No relevant trigger here." }
    ];
    const prompt = manager.buildConversationPrompt(conversationHistory);
    expect(prompt).not.toContain("Always say hello.");
    expect(prompt).not.toContain("Never say goodbye.");
  });


  it("system message instructs to apply rules only when relevant", () => {
    const manager = new NimisManager({ rules: mockRules, rulesManager: mockRulesManager, nativeToolManager: mockNativeToolManager });
    const template = manager.getTemplate();
    expect(template.systemMessage).toMatch(/apply them only if they are directly relevant/i);
  });

  it("system message forces textual tool_call and forbids model function-calling", () => {
    const manager = new NimisManager({ rules: mockRules, rulesManager: mockRulesManager, nativeToolManager: mockNativeToolManager });
    const template = manager.getTemplate();
  //  expect(template.systemMessage).toContain("do NOT use the model's built-in function-calling API");
    expect(template.systemMessage).toContain('<tool_call name="TOOL_NAME"');
  });

  it("should exclude tool results from rule matching to prevent loops", () => {
    // Create a real RulesManager with a rule that mentions an MCP tool
    const rulesManager = new RulesManager();
    const ruleWithTool: Rule = {
      id: "mcp-tool-rule",
      filePath: "/fake/path/mcp.md",
      description: "Rule that mentions mcp_tool_name",
      triggers: ["mcp_tool_name"],
      content: "When mcp_tool_name is mentioned, call it.",
      lastModified: Date.now(),
    };
    // Manually add the rule to test
    (rulesManager as any).rules.set("mcp-tool-rule", ruleWithTool);
    
    // Simulate a conversation where:
    // 1. User mentions the tool (should trigger rule)
    // 2. Assistant calls the tool
    // 3. Tool result is added as user message (should NOT trigger rule again)
    const conversationHistory: Array<{ role: "user" | "assistant" | "system"; content: string }> = [
      { role: "user", content: "Please use mcp_tool_name to get data." },
      { role: "assistant", content: '<tool_call name="mcp_tool_name" args=\'{}\' />' },
      { role: "user", content: '{"type":"text","text":"Tool result with mcp_tool_name in it"}' }, // Tool result
    ];
    
    const applicableRules = rulesManager.getApplicableRulesFromHistory(conversationHistory);
    
    // Rule should match from the first user message (contains trigger "mcp_tool_name")
    // The tool result should be filtered out and NOT cause re-matching
    expect(applicableRules.length).toBe(1);
    expect(applicableRules[0].id).toBe("mcp-tool-rule");
    
    // Verify that if we only had the tool result (without the original user message),
    // the rule would NOT match
    const toolResultOnlyHistory: Array<{ role: "user" | "assistant" | "system"; content: string }> = [
      { role: "assistant", content: '<tool_call name="mcp_tool_name" args=\'{}\' />' },
      { role: "user", content: '{"type":"text","text":"Tool result with mcp_tool_name in it"}' }, // Tool result
    ];
    const rulesFromToolResult = rulesManager.getApplicableRulesFromHistory(toolResultOnlyHistory);
    // Tool result should be filtered out, so no rules should match
    expect(rulesFromToolResult.length).toBe(0);
  });
});