// Converted from Chai to Jest
import {
  HarmonyParser,
  ParsedResponse,
} from "../src/utils/HarmonyParser";

describe("HarmonyParser", () => {
  describe("parse", () => {
    it("should not include assistant or final in the final message", () => {
      const input = "<|start|>assistant<|channel|>final<|message|>Hello!<|end|>";
      const result: ParsedResponse = HarmonyParser.parse(input);
      expect(result.content).toBe("Hello!");
      expect(result.content).not.toMatch(/assistant|final/);
      expect(result.raw).toBe(input);
    });
    
    it("should parse a simple Harmony protocol message", () => {
      const input =
        "<|start|>assistant<|channel|>final<|message|>Hello! I'm here to help.<|end|>";
      const result: ParsedResponse = HarmonyParser.parse(input);

      expect(result.content).toBe("Hello! I'm here to help.");
      expect(result.reasoning).toBeUndefined();
      expect(result.tool_calls).toBeUndefined();
      expect(result.raw).toBe(input);
    });

    it("should handle multiple chained messages", () => {
      const input =
        "<|start|>assistant<|channel|>reasoning<|message|>Thinking about the response...<|end|><|start|>assistant<|channel|>final<|message|>Hello! What can I help with?<|end|>";
      const result: ParsedResponse = HarmonyParser.parse(input);

      expect(result.content).toBe("Hello! What can I help with?");
      // The reasoning channel should be extracted as reasoning
      expect(result.reasoning).toBe("Thinking about the response...");
      expect(result.raw).toBe(input);
    });

    it("should handle nested or complex messages", () => {
      const input =
        "<|start|>assistant<|channel|>final<|message|>Hello! I'm here to help with prototyping.<|assistant|>assistant<|final|>What can I assist you with?<|end|>";
      const result: ParsedResponse = HarmonyParser.parse(input);

      expect(result.content).toBe(
        "Hello! I'm here to help with prototyping. What can I assist you with?"
      );
      expect(result.raw).toBe(input);
    });

    it("should parse partial Harmony (streaming chunk without <|end|>)", () => {
      const input =
        "<|start|>assistant<|channel|>final<|message|>Sure! I'd be happy to analyze a Latin word for you. Please provide the word";
      const result: ParsedResponse = HarmonyParser.parse(input);

      expect(result.content).toBe(
        "Sure! I'd be happy to analyze a Latin word for you. Please provide the word"
      );
      expect(result.raw).toBe(input);
    });

    it("should return input as-is if no Harmony tags are present", () => {
      const input = "This is a plain text message.";
      const result: ParsedResponse = HarmonyParser.parse(input);

      expect(result.content).toBe("This is a plain text message.");
      expect(result.reasoning).toBeUndefined();
      expect(result.tool_calls).toBeUndefined();
      expect(result.raw).toBe(input);
    });

    it("should handle malformed input gracefully", () => {
      const input =
        "<|start|>assistant<|channel|>final<|message|>Hello!<|end|>"; // Missing closing tags properly
      const result: ParsedResponse = HarmonyParser.parse(input);

      expect(result.content).toBe("Hello!");
      expect(result.raw).toBe(input);
    });

    it("should extract reasoning from thinking tags", () => {
      const input = "<thinking>I need to analyze this carefully</thinking>Hello World!";
      const result: ParsedResponse = HarmonyParser.parse(input);

      expect(result.reasoning).toBe("I need to analyze this carefully");
      expect(result.content).toContain("Hello World!");
    });

    it("should extract reasoning from Harmony think channel", () => {
      const input =
        "<|start|>assistant<|channel|>think<|message|>Analyzing the question...<|end|><|start|>assistant<|channel|>final<|message|>Here's my answer.<|end|>";
      const result: ParsedResponse = HarmonyParser.parse(input);

      expect(result.reasoning).toBe("Analyzing the question...");
      expect(result.content).toBe("Here's my answer.");
    });

    it("should extract tool calls from response", () => {
      const input = 'Let me help you. <tool_call name="read_file" args=\'{"path": "test.ts"}\' />';
      const result: ParsedResponse = HarmonyParser.parse(input);

      expect(result.tool_calls).toBeDefined();
      expect(result.tool_calls?.length).toBeGreaterThan(0);
      expect(result.tool_calls?.[0].name).toBe("read_file");
    });

    it("should extract multiple tool calls", () => {
      const input = '<tool_call name="tool1" args=\'{}\' /> and <tool_call name="tool2" args=\'{}\' />';
      const result: ParsedResponse = HarmonyParser.parse(input);

      expect(result.tool_calls).toBeDefined();
      expect(result.tool_calls?.length).toBe(2);
      expect(result.tool_calls?.[0].name).toBe("tool1");
      expect(result.tool_calls?.[1].name).toBe("tool2");
    });

    it("should extract create_file from llama-server content-only format (parsed message)", () => {
      // Simulates the content field from llama-server parsed message:
      // Content-only format with optional prefix + tool call
      const toolCall =
        '<tool_call name="create_file" args=\'{ "file_path": "hello.py", "content": "# Python script to greet Maria\\n\\ndef greet_maria():\\n    \\"\\"\\"Function to greet Maria\\"\\"\\"\\n    print(\\"Hello, Maria!\\")\\n    print(\\"Nice to meet you!\\")\\n\\nif __name__ == \\"__main__\\":\\n    greet_maria()\\n" }\' />';
      const contentOnly =
        "æ<88><91>ä¼<9a>å¸®ä½ å<88><9b>å»ºä¸<80>ä¸ªPythonè<84><9a>æ<9c>¬æ<9d>¥é<97>®å<80><99>Mariaã<80><82>\n\n" +
        toolCall;
      const result: ParsedResponse = HarmonyParser.parse(contentOnly);

      expect(result.tool_calls).toBeDefined();
      expect(result.tool_calls?.length).toBe(1);
      expect(result.tool_calls?.[0].name).toBe("create_file");
      expect(result.tool_calls?.[0].arguments?.file_path).toBe("hello.py");
      const content = result.tool_calls?.[0].arguments?.content ?? "";
      expect(content).toContain("# Python script to greet Maria");
      expect(content).toContain("def greet_maria():");
      expect(content).toContain('if __name__ == "__main__":');
    });
  });
});
