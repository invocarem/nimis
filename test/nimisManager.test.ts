import { NimisManager } from "../src/utils/nimisManager";
import type { Rule } from "../src/rulesManager";

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
  } as any;

  it("should include rules in the system message", () => {
    const manager = new NimisManager({ rules: mockRules, rulesManager: mockRulesManager, nativeToolManager: mockNativeToolManager });
    const template = manager.getTemplate();
    expect(template.systemMessage).toContain("Always say hello.");
    expect(template.systemMessage).toContain("Never say goodbye.");
  });

  it("should update rules and system message with setRules", () => {
    const manager = new NimisManager({ rules: [], rulesManager: mockRulesManager, nativeToolManager: mockNativeToolManager });
    manager.setRules(mockRules);
    const template = manager.getTemplate();
    expect(template.systemMessage).toContain("Always say hello.");
    expect(template.systemMessage).toContain("Never say goodbye.");
  });
});