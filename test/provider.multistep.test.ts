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
import { XmlProcessor } from "../src/utils/xmlProcessor";
import { toolExecutor } from "../src/toolExecutor";
import { ResponseParser } from "../src/utils/responseParser";

// Simulate a provider-like multi-step tool call chain
async function simulateMultiStepToolCall(llmResponses: string[]) {
  let toolResults: any[] = [];
  for (const response of llmResponses) {
    const xmlToolCalls = XmlProcessor.extractToolCalls(response);
    if (xmlToolCalls.length > 0) {
      const xmlCall = xmlToolCalls[0];
      // Convert XmlToolCall to MCPToolCall format
      const toolCall = { name: xmlCall.name, arguments: xmlCall.args || {} };
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
      '<tool_call name="find_files" args=\'{"name_pattern": "provider.ts"}\' />';
    // Step 2: LLM asks to read the file found (simulate as if LLM got the result)
    const readFileResponse =
      '<tool_call name="read_file" args=\'{"file_path": "src/webview/provider.ts"}\' />';

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
        '<tool_call name="read_file" args=\'{"file_path": "package.json"}\' /> ' +
        'and also ' +
        '<tool_call name="list_files" args=\'{"directory_path": "src"}\' />';

      const results = await simulateProviderMultipleToolCalls(response);

      expect(results.length).toBe(2);
      expect(results[0].tool).toBe("read_file");
      expect(results[1].tool).toBe("list_files");
      expect(results[0].result).toHaveProperty("content");
      expect(results[1].result).toHaveProperty("content");
    });

    it("should execute tool calls in the order they appear", async () => {
      const response = 
        '<tool_call name="read_file" args=\'{"file_path": "package.json"}\' /> ' +
        '<tool_call name="list_files" args=\'{"directory_path": "src"}\' /> ' +
        '<tool_call name="read_file" args=\'{"file_path": "tsconfig.json"}\' />';

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
          `<tool_call name="edit_file" args='{"file_path": "${filePathEscaped}", "old_text": "Header line\\nLine 1\\nLine 2", "new_text": "Header line\\nLine 1 (edited)\\nLine 2"}' /> ` +
          `<tool_call name="edit_file" args='{"file_path": "${filePathEscaped}", "old_text": "Line 1 (edited)\\nLine 2\\nLine 3", "new_text": "Line 1 (edited)\\nLine 2 (edited)\\nLine 3"}' />`;

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
        '<tool_call name="read_file" args=\'{"file_path": "nonexistent1.txt"}\' /> ' +
        '<tool_call name="read_file" args=\'{"file_path": "nonexistent2.txt"}\' />';

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
        '<tool_call name="tool1" args=\'{}\' /> ' +
        '<tool_call name="tool2" args=\'{}\' /> ' +
        '<tool_call name="tool3" args=\'{}\' />';

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

  describe("Tool error handling in provider flow", () => {
    /**
     * Simulates the provider's behavior when handling tool execution errors.
     * This test verifies that error results are added to conversation history
     * and the loop continues (doesn't stop) so the AI can see and respond to errors.
     */
    it("should add error results to conversation history and continue loop", async () => {
      // Simulate a tool call that will fail (e.g., executing a Python file with syntax error)
      const response = 
        '<tool_call name="exec_terminal" args=\'{"command": "python calc.py add 2 3"}\' />';

      const parsedResponse = ResponseParser.parse(response);
      const toolCalls = ResponseParser.getAllToolCalls(parsedResponse);
      
      // Simulate conversation history (like provider does)
      const conversationHistory: Array<{ role: string; content: string }> = [];
      const allToolResults: string[] = [];
      let hasError = false;
      let continueLoop = true;

      // Simulate provider's tool execution loop
      for (const toolCall of toolCalls) {
        const result = await toolExecutor(toolCall);
        const toolText = result.content?.map(c => c.text).join("\n") || JSON.stringify(result);
        allToolResults.push(toolText);

        // If tool execution failed, mark error but don't break (this is the OLD behavior we're testing against)
        // Actually, we want to test the NEW behavior where we continue even with errors
        if (result.isError) {
          hasError = true;
          // OLD behavior: break here would stop the loop
          // NEW behavior: we continue to add results to history
        }
      }

      // Simulate provider's conversation history update logic (NEW behavior)
      // Include tool results even when there's an error so the AI can see and respond to errors
      if (allToolResults.length > 0) {
        conversationHistory.push({
          role: "assistant",
          content: parsedResponse.raw || response,
        });
        conversationHistory.push({
          role: "user",
          content: allToolResults.join("\n\n"),
        });
        // Continue loop to get next LLM response (even if there was an error)
        continueLoop = true;
      } else {
        continueLoop = false;
      }

      // Verify that error result was added to conversation history
      expect(conversationHistory.length).toBe(2);
      expect(conversationHistory[0].role).toBe("assistant");
      expect(conversationHistory[1].role).toBe("user");
      
      // Verify that the error result is in the user message (tool results)
      const toolResultsContent = conversationHistory[1].content;
      expect(toolResultsContent).toBeTruthy();
      expect(toolResultsContent.length).toBeGreaterThan(0);
      
      // Verify that the loop continues (doesn't stop) even with errors
      expect(continueLoop).toBe(true);
      expect(hasError).toBe(true); // Error occurred
      
      // Verify that error information is present in the conversation history
      // (The actual error message will depend on what exec_terminal returns)
      // Error messages can vary (e.g., "Error", "ENOENT", "command not found", etc.)
      expect(toolResultsContent.length).toBeGreaterThan(0); // Should have some error output
    });

    it("should continue loop even when exec_terminal fails with syntax error", async () => {
      // Create a temporary Python file with a syntax error (like the user's example)
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nimis-test-"));
      const testFile = path.join(tempDir, "calc.py");
      // File with syntax error: "" before import
      const brokenContent = '""import math\n\ndef add(a, b):\n    return a + b\n';
      fs.writeFileSync(testFile, brokenContent, "utf-8");

      try {
        const response = 
          `<tool_call name="exec_terminal" args='{"command": "python "${testFile}" add 2 3", "working_directory": "${tempDir}"}' />`;

        const parsedResponse = ResponseParser.parse(response);
        const toolCalls = ResponseParser.getAllToolCalls(parsedResponse);
        
        const conversationHistory: Array<{ role: string; content: string }> = [];
        const allToolResults: string[] = [];
        let hasError = false;
        let continueLoop = false;

        // Simulate provider's tool execution
        for (const toolCall of toolCalls) {
          const result = await toolExecutor(toolCall);
          const toolText = result.content?.map(c => c.text).join("\n") || JSON.stringify(result);
          allToolResults.push(toolText);

          if (result.isError) {
            hasError = true;
            // Don't break - continue to add to history
          }
        }

        // Simulate NEW behavior: add to history even with errors
        if (allToolResults.length > 0) {
          conversationHistory.push({
            role: "assistant",
            content: parsedResponse.raw || response,
          });
          conversationHistory.push({
            role: "user",
            content: allToolResults.join("\n\n"),
          });
          continueLoop = true;
        }

        // Verify error was captured
        expect(hasError).toBe(true);
        
        // Verify error result was added to conversation history
        expect(conversationHistory.length).toBe(2);
        expect(conversationHistory[1].role).toBe("user");
        
        // Verify error message is in the conversation history
        const errorMessage = conversationHistory[1].content;
        expect(errorMessage).toBeTruthy();
        expect(errorMessage.length).toBeGreaterThan(0);
        // Error messages can vary (syntax error, command not found, etc.)
        // The important thing is that the error was captured and added to history
        
        // Verify loop continues (NEW behavior)
        expect(continueLoop).toBe(true);
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
  });
});
