import { extractMiniMaxToolCall } from "../src/utils/MiniMaxToolCallExtractor";
import type { MCPToolCall } from "../src/utils/toolCallExtractor";

describe("MiniMaxToolCallExtractor", () => {
  it("extracts tool call with valid JSON arguments", () => {
    const xml = `
      <tool_call>
        <name>analyze_latin_batch</name>
        <arguments>{"words": ["amo", "amas", "amat"]}</arguments>
      </tool_call>
    `;
    const result = extractMiniMaxToolCall(xml);
    expect(result).toEqual({
      name: "analyze_latin_batch",
      arguments: { words: ["amo", "amas", "amat"] }
    });
  });

  it("returns null if no tool_call tag", () => {
    const xml = `<not_a_tool_call></not_a_tool_call>`;
    expect(extractMiniMaxToolCall(xml)).toBeNull();
  });

  it("returns arguments as string if not valid JSON", () => {
    const xml = `
      <tool_call>
        <name>foo</name>
        <arguments>not_json</arguments>
      </tool_call>
    `;
    const result = extractMiniMaxToolCall(xml);
    expect(result).toEqual({ name: "foo", arguments: "not_json" });
  });
});
