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

  it("handles namespaced <minimax:tool_call> with <name> + <arguments>", () => {
    const xml = `
      <minimax:tool_call>
        <name>do_something</name>
        <arguments>{"x": 1}</arguments>
      </minimax:tool_call>
    `;
    expect(extractMiniMaxToolCall(xml)).toEqual({ name: "do_something", arguments: { x: 1 } });
  });

  it("parses <invoke name=...> with <parameter name=...> entries", () => {
    const xml = `
      <minimax:tool_call>
        <invoke name="create_file">
          <parameter name="file_path">hello.py</parameter>
          <parameter name="content"># Simple greeting script for Maria

def greet(name="Maria"):
    print(f"Hello, {name}!")

if (__name__ == "__main__"):
    greet("Maria")</parameter>
        </invoke>
      </minimax:tool_call>
    `;

    const res = extractMiniMaxToolCall(xml);
    expect(res).not.toBeNull();
    expect(res).toEqual({
      name: "create_file",
      arguments: {
        file_path: "hello.py",
        content: `# Simple greeting script for Maria

def greet(name="Maria"):
    print(f"Hello, {name}!")

if (__name__ == "__main__"):
    greet("Maria")`
      }
    });
  });
});
