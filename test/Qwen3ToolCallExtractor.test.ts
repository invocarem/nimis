import {
  extractQwen3ToolCall,
  extractQwen3ToolCalls
} from "../src/utils/Qwen3ToolCallExtractor";
import type { MCPToolCall } from "../src/utils/toolCallExtractor";

describe("Qwen3ToolCallExtractor", () => {
  it("extracts tool call from user example format (no closing </parameter>)", () => {
    const xml = `<tool_call> <function=file_glob_search> <parameter=pattern> gotx-op.xml </tool_call>`;
    const result = extractQwen3ToolCall(xml);
    expect(result).toEqual({
      name: "file_glob_search",
      arguments: { pattern: "gotx-op.xml" }
    });
  });

  it("extracts tool call with explicit </parameter>", () => {
    const xml = `
      <tool_call>
        <function=read_file>
        <parameter=path>src/index.ts</parameter>
      </tool_call>
    `;
    const result = extractQwen3ToolCall(xml);
    expect(result).toEqual({
      name: "read_file",
      arguments: { path: "src/index.ts" }
    });
  });

  it("extracts multiple parameters", () => {
    const xml = `
      <tool_call>
        <function=edit_file>
        <parameter=file_path>test.py</parameter>
        <parameter=old_text>foo</parameter>
        <parameter=new_text>bar</parameter>
      </tool_call>
    `;
    const result = extractQwen3ToolCall(xml);
    expect(result).toEqual({
      name: "edit_file",
      arguments: { file_path: "test.py", old_text: "foo", new_text: "bar" }
    });
  });

  it("returns null if no <function= inside <tool_call>", () => {
    const xml = `<tool_call name="read_file" args='{"path": "x"}' />`;
    expect(extractQwen3ToolCall(xml)).toBeNull();
  });

  it("returns null if no tool_call tag", () => {
    expect(extractQwen3ToolCall("plain text")).toBeNull();
  });

  it("extractQwen3ToolCalls returns all tool calls", () => {
    const xml = `
      <tool_call><function=tool1><parameter=x>1</parameter></tool_call>
      <tool_call><function=tool2><parameter=y>2</parameter></tool_call>
    `;
    const results = extractQwen3ToolCalls(xml);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ name: "tool1", arguments: { x: "1" } });
    expect(results[1]).toEqual({ name: "tool2", arguments: { y: "2" } });
  });

  it("parses JSON-like parameter values when applicable", () => {
    const xml = `
      <tool_call>
        <function=create_file>
        <parameter=file_path>config.json</parameter>
        <parameter=content>{"key": "value"}</parameter>
      </tool_call>
    `;
    const result = extractQwen3ToolCall(xml);
    expect(result?.arguments?.content).toEqual({ key: "value" });
  });
});
