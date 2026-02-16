import { extractHarmonyToolCall } from "../src/utils/HarmonyToolCallExtractor";
import type { MCPToolCall } from "../src/utils/toolCallExtractor";

describe("HarmonyToolCallExtractor", () => {
  it("extracts tool call from Harmony format (OpenAI Harmony)", () => {
    const response =
      '<|start|>assistant<|channel|>analysis to=tool_call code<|message|>{\n  "name": "analyze_latin",\n  "arguments": {\n    "word": "invenietur"\n  }\n}\n\n';
    const result = extractHarmonyToolCall(response);
    expect(result).toEqual({
      name: "analyze_latin",
      arguments: { word: "invenietur" },
    });
  });

  it("returns null if no Harmony tool_call marker", () => {
    const response = "<|start|>assistant<|channel|>analysis<|message|>Hello</|end|>";
    expect(extractHarmonyToolCall(response)).toBeNull();
  });

  it("extracts tool call with empty arguments", () => {
    const response =
      'to=tool_call code<|message|>{"name": "ping", "arguments": {}}\n';
    const result = extractHarmonyToolCall(response);
    expect(result).toEqual({ name: "ping", arguments: {} });
  });

  it("returns null when name is missing in JSON", () => {
    const response = 'to=tool_call code<|message|>{"arguments": {"x": 1}}\n';
    expect(extractHarmonyToolCall(response)).toBeNull();
  });
});
