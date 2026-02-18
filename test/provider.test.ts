// Converted from Chai to Jest
jest.mock("axios", () => ({
  create: () => ({
    post: jest.fn(),
    get: jest.fn(),
  }),
}));
import * as sinon from "sinon";
import * as vscode from "vscode";
import { LlamaClient } from "../src/api/llamaClient";
import { LLMResponseProcessor } from "../src/utils/llmResponseProcessor";
import { NimisViewProvider } from "../src/webview/provider";

describe("NimisViewProvider Integration", () => {
  let mockLlamaClient: sinon.SinonStubbedInstance<LlamaClient>;

  beforeEach(() => {
    mockLlamaClient = sinon.createStubInstance(LlamaClient);
    // Manually stub the methods since createStubInstance doesn't do it automatically
    mockLlamaClient.complete = sinon.stub();
    mockLlamaClient.healthCheck = sinon.stub();
  });

  describe("LlamaClient Integration", () => {
    it("should be able to create a mock LlamaClient", () => {
      expect(mockLlamaClient).toBeInstanceOf(LlamaClient);
    });

    it("should handle complete calls", async () => {
      (mockLlamaClient.complete as sinon.SinonStub).resolves("Mock response");

      const result = await mockLlamaClient.complete({ prompt: "test message" });

      expect(result).toBe("Mock response");
      expect((mockLlamaClient.complete as sinon.SinonStub).calledOnce).toBe(
        true
      );
      expect(
        (mockLlamaClient.complete as sinon.SinonStub).calledWith({
          prompt: "test message",
        })
      ).toBe(true);
    });

    it("should handle healthCheck calls", async () => {
      (mockLlamaClient.healthCheck as sinon.SinonStub).resolves(true);

      const result = await mockLlamaClient.healthCheck();

      expect(result).toBe(true);
      expect((mockLlamaClient.healthCheck as sinon.SinonStub).calledOnce).toBe(
        true
      );
    });

    it("should handle health check failures", async () => {
      (mockLlamaClient.healthCheck as sinon.SinonStub).resolves(false);

      const result = await mockLlamaClient.healthCheck();

      expect(result).toBe(false);
      expect((mockLlamaClient.healthCheck as sinon.SinonStub).calledOnce).toBe(
        true
      );
    });

    it("should handle complete errors", async () => {
      const error = new Error("Connection failed");
      (mockLlamaClient.complete as sinon.SinonStub).rejects(error);

      await expect(
        mockLlamaClient.complete({ prompt: "test message" })
      ).rejects.toThrow(error);
      expect((mockLlamaClient.complete as sinon.SinonStub).calledOnce).toBe(
        true
      );
    });
  });

  describe("LLMResponseProcessor Integration", () => {
    it("should preprocess markdown and code blocks correctly", () => {
      const input = `python\ndef foo():\n    return 42\nUsage: Call foo()`;
      const expected =
        "```python\ndef foo():\n    return 42\n```\nUsage: Call foo()";
      const result = LLMResponseProcessor.preprocess(input);
      expect(result.replace(/\n/g, "")).toContain(expected.replace(/\n/g, ""));
    });

    it("should format JSON code blocks", () => {
      const processor = new LLMResponseProcessor({
        enableJsonFormatting: true,
      });
      const input = '```json\n{"a":1,"b":2}\n```';
      const html = processor.format(input);
      expect(html).toContain("language-json");
      expect(html).toContain("&quot;a&quot;");
    });

    it("should escape HTML in code blocks", () => {
      const processor = new LLMResponseProcessor();
      const input = "```html\n<div>test</div>\n```";
      const html = processor.format(input);
      expect(html).toContain("&lt;div&gt;test&lt;/div&gt;");
    });
  });

  describe("NimisViewProvider — current file wiring", () => {
    it("should set currentFilePath from active editor on user message", async () => {
      // Arrange: set active editor in mocked vscode
      (vscode.window as any).activeTextEditor = {
        document: { uri: { fsPath: "src/utils/nimisStateTracker.ts" } },
      };

      const provider = new NimisViewProvider(vscode.Uri.file("/fake"));
      // Stub llamaClient to avoid external calls
      (provider as any).llamaClient = {
        streamComplete: async (_opts: any, onChunk: (c: string) => void) => {
          onChunk("Assistant final response.");
          return Promise.resolve();
        },
        healthCheck: async () => true,
      };

      // Act
      await (provider as any)._handleUserMessage("hello");

      // Assert
      const current = (provider as any).nimisManager
        .getStateTracker()
        .getCurrentFilePath();
      expect(current).toBe("src/utils/nimisStateTracker.ts");
    });
  });
});
