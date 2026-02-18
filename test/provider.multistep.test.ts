// Mock vscode for test environment
jest.mock("vscode", () => ({
  workspace: {
    workspaceFolders: [
      { uri: { fsPath: "/home/chenchen/code/nimis-extension" } }
    ],
    getConfiguration: jest.fn(() => ({
      get: jest.fn((key: string, defaultValue: any) => defaultValue)
    }))
  },
  window: {
    activeTextEditor: null
  }
}));

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { extractToolCall } from "../src/utils/toolCallExtractor";
import { toolExecutor } from "../src/toolExecutor";
import { ResponseParser } from "../src/utils/responseParser";

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

// Simulate provider behavior: extract and execute all tool calls from a single response
async function simulateProviderMultipleToolCalls(response: string) {
  const parsedResponse = ResponseParser.parse(response);
  const toolCalls = ResponseParser.getAllToolCalls(parsedResponse);
  const results: Array<{ tool: string; result: any }> = [];

  for (const toolCall of toolCalls) {
    const result = await toolExecutor(toolCall);
    results.push({ tool: toolCall.name, result });
  }

  return results;
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

  describe("Multiple tool calls in single response", () => {
    it("should extract and execute all tool calls from a single response", async () => {
      const response = 
        'I need to do multiple things. ' +
        'tool_call(name="read_file", arguments={"file_path": "package.json"}) ' +
        'and also ' +
        'tool_call(name="list_files", arguments={"directory_path": "src"})';

      const results = await simulateProviderMultipleToolCalls(response);

      expect(results.length).toBe(2);
      expect(results[0].tool).toBe("read_file");
      expect(results[1].tool).toBe("list_files");
      expect(results[0].result).toHaveProperty("content");
      expect(results[1].result).toHaveProperty("content");
    });

    it("should execute tool calls in the order they appear", async () => {
      const response = 
        'tool_call(name="read_file", arguments={"file_path": "package.json"}) ' +
        'tool_call(name="list_files", arguments={"directory_path": "src"}) ' +
        'tool_call(name="read_file", arguments={"file_path": "tsconfig.json"})';

      const executionOrder: string[] = [];
      const parsedResponse = ResponseParser.parse(response);
      const toolCalls = ResponseParser.getAllToolCalls(parsedResponse);

      for (const toolCall of toolCalls) {
        executionOrder.push(toolCall.name);
        await toolExecutor(toolCall);
      }

      expect(executionOrder).toEqual(["read_file", "list_files", "read_file"]);
    });

    it("should save file edits between sequential edit_file calls", async () => {
      // Create a temporary test file in a simpler location
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nimis-test-"));
      const testFile = path.join(tempDir, "test.txt");
      // Use more content to provide context for edits
      const initialContent = "Header line\nLine 1\nLine 2\nLine 3\nFooter line\n";
      fs.writeFileSync(testFile, initialContent, "utf-8");

      try {
        // Simulate multiple edit_file calls in a single response
        // First edit: change "Line 1\n" to "Line 1 (edited)\n"
        // Second edit: change "Line 2\n" to "Line 2 (edited)\n"
        // Include context to meet edit_file requirements (min 10 chars, 2+ lines)
        const filePathEscaped = testFile.replace(/\\/g, "/"); // Use forward slashes for cross-platform
        const response = 
          `tool_call(name="edit_file", arguments={"file_path": "${filePathEscaped}", "old_text": "Header line\\nLine 1\\nLine 2", "new_text": "Header line\\nLine 1 (edited)\\nLine 2"}) ` +
          `tool_call(name="edit_file", arguments={"file_path": "${filePathEscaped}", "old_text": "Line 1 (edited)\\nLine 2\\nLine 3", "new_text": "Line 1 (edited)\\nLine 2 (edited)\\nLine 3"})`;

        const parsedResponse = ResponseParser.parse(response);
        const toolCalls = ResponseParser.getAllToolCalls(parsedResponse);

        expect(toolCalls.length).toBe(2);
        expect(toolCalls[0].name).toBe("edit_file");
        expect(toolCalls[1].name).toBe("edit_file");

        // Execute first edit
        const result1 = await toolExecutor(toolCalls[0]);
        if (result1.isError) {
          console.error("First edit error:", result1.content?.map(c => c.text).join("\n"));
        }
        expect(result1.isError).toBeFalsy();

        // Verify first edit was saved
        const contentAfterFirst = fs.readFileSync(testFile, "utf-8");
        expect(contentAfterFirst).toContain("Line 1 (edited)");
        expect(contentAfterFirst).toContain("Line 2"); // Second line should still be unchanged (not "Line 2 (edited)")

        // Execute second edit
        const result2 = await toolExecutor(toolCalls[1]);
        if (result2.isError) {
          console.error("Second edit error:", result2.content?.map(c => c.text).join("\n"));
        }
        expect(result2.isError).toBeFalsy();

        // Verify both edits were saved
        const finalContent = fs.readFileSync(testFile, "utf-8");
        expect(finalContent).toContain("Line 1 (edited)");
        expect(finalContent).toContain("Line 2 (edited)");
        expect(finalContent).toContain("Line 3");
        expect(finalContent).toContain("Header line");
        expect(finalContent).toContain("Footer line");
      } finally {
        // Cleanup
        if (fs.existsSync(testFile)) {
          fs.unlinkSync(testFile);
        }
        if (fs.existsSync(tempDir)) {
          fs.rmdirSync(tempDir);
        }
      }
    });

    it("should stop execution on first error", async () => {
      const response = 
        'tool_call(name="read_file", arguments={"file_path": "nonexistent1.txt"}) ' +
        'tool_call(name="read_file", arguments={"file_path": "nonexistent2.txt"})';

      const parsedResponse = ResponseParser.parse(response);
      const toolCalls = ResponseParser.getAllToolCalls(parsedResponse);
      const results: any[] = [];
      let hasError = false;

      for (const toolCall of toolCalls) {
        const result = await toolExecutor(toolCall);
        results.push(result);
        if (result.isError) {
          hasError = true;
          break;
        }
      }

      expect(results.length).toBe(1); // Should stop after first error
      expect(hasError).toBe(true);
      expect(results[0].isError).toBe(true);
    });

    it("should handle ResponseParser.getAllToolCalls correctly", () => {
      const response = 
        'tool_call(name="tool1", arguments={}) ' +
        'tool_call(name="tool2", arguments={}) ' +
        'tool_call(name="tool3", arguments={})';

      const parsedResponse = ResponseParser.parse(response);
      const allToolCalls = ResponseParser.getAllToolCalls(parsedResponse);
      const firstToolCall = ResponseParser.getFirstToolCall(parsedResponse);

      expect(allToolCalls.length).toBe(3);
      expect(allToolCalls[0].name).toBe("tool1");
      expect(allToolCalls[1].name).toBe("tool2");
      expect(allToolCalls[2].name).toBe("tool3");
      expect(firstToolCall?.name).toBe("tool1");
    });
  });
});
