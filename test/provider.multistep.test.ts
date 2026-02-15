// Mock vscode for test environment
jest.mock("vscode", () => ({
  workspace: {
    workspaceFolders: [
      { uri: { fsPath: "/home/chenchen/code/nimis-extension" } }
    ]
  },
  window: {
    activeTextEditor: null
  }
}));

import { extractToolCall } from "../src/utils/toolCallExtractor";
import { toolExecutor } from "../src/toolExecutor";

// Simulate a provider-like multi-step tool call chain
async function simulateMultiStepToolCall(llmResponses: string[]) {
  let toolResults: any[] = [];
  for (const response of llmResponses) {
    const toolCall = extractToolCall(response);
    if (toolCall) {
      // Simulate tool execution (mocked)
      const result = await toolExecutor(toolCall);
      toolResults.push({ tool: toolCall.name, result });
    }
  }
  return toolResults;
}

describe("Multi-step tool call chain", () => {
  it("should execute find_files then read_file in sequence", async () => {
    // Step 1: LLM asks to find files
    const findFilesResponse =
      'tool_call(name="find_files", arguments={"name_pattern": "provider.ts"})';
    // Step 2: LLM asks to read the file found (simulate as if LLM got the result)
    const readFileResponse =
      'tool_call(name="read_file", arguments={"file_path": "src/webview/provider.ts"})';

    // Simulate the provider running both tool calls in sequence
    const results = await simulateMultiStepToolCall([
      findFilesResponse,
      readFileResponse,
    ]);

    expect(results.length).toBe(2);
    expect(results[0].tool).toBe("find_files");
    expect(results[1].tool).toBe("read_file");
    // Optionally check result structure
    expect(results[0].result).toHaveProperty("content");
    expect(results[1].result).toHaveProperty("content");
  });
});
