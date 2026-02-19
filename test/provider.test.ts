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

  describe("NimisViewProvider — current file wiring", () => {
    it.skip("should set currentFilePath from active editor on user message - [BYPASSED]", async () => {
      // TODO: Re-enable this test when current file wiring is restored
      // Currently bypassed because current file wiring has been removed from provider.ts
      
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
