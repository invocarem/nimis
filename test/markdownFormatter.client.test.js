const {
  formatMarkdown,
  parseHarmonyMessage,
} = require("../src/webview/assets/markdownFormatter.js");

describe("Client-side Markdown Formatting", () => {
  describe("parseHarmonyMessage", () => {
    it("should parse a simple Harmony protocol message", () => {
      const input =
        "<|start|>assistant<|channel|>final<|message|>Hello! I'm here to help.<|end|>";
      const result = parseHarmonyMessage(input);

      expect(result.finalMessage).toBe("Hello! I'm here to help.");
      expect(result.channels).toEqual(["final"]);
      expect(result.metadata).toEqual({});
    });

    it("should handle multiple chained messages", () => {
      const input =
        "<|start|>assistant<|channel|>reasoning<|message|>Thinking about the response...<|end|><|start|>assistant<|channel|>final<|message|>Hello! What can I help with?<|end|>";
      const result = parseHarmonyMessage(input);

      expect(result.finalMessage).toBe("Hello! What can I help with?");
      expect(result.channels).toEqual(["reasoning", "final"]);
      expect(result.metadata).toEqual({});
    });

    it("should return input as-is if no Harmony tags are present", () => {
      const input = "This is a plain text message.";
      const result = parseHarmonyMessage(input);

      expect(result.finalMessage).toBe("This is a plain text message.");
      expect(result.channels).toEqual([]);
      expect(result.metadata).toEqual({});
    });

    it("should parse partial Harmony (streaming chunk without <|end|>)", () => {
      const input =
        "<|start|>assistant<|channel|>final<|message|>Sure! I'd be happy to analyze a Latin word for you. Please provide the word";
      const result = parseHarmonyMessage(input);

      expect(result.finalMessage).toBe(
        "Sure! I'd be happy to analyze a Latin word for you. Please provide the word"
      );
      expect(result.channels).toEqual(["final"]);
    });
  });

  describe("formatMarkdown", () => {
    it("should parse Harmony protocol and format the final message", () => {
      const input =
        "<|start|>assistant<|channel|>final<|message|>Hello! How can I assist you?<|end|>";
      const output = formatMarkdown(input);

      expect(output).toContain("Hello! How can I assist you?");
      expect(output).not.toContain("<|start|>");
      expect(output).not.toContain("<|end|>");
      expect(output).toContain("<p>");
    });

    it("should format plain markdown text", () => {
      const input = "This is **bold** and *italic* text.";
      const output = formatMarkdown(input);

      expect(output).toContain("<strong>bold</strong>");
      expect(output).toContain("<em>italic</em>");
      expect(output).toContain("<p>");
    });

    it("should format code blocks", () => {
      const input = "```javascript\nconsole.log('hello');\n```";
      const output = formatMarkdown(input);

      expect(output).toContain('<div class="code-block-container">');
      expect(output).toContain('data-language="javascript"');
      // Code is HTML-escaped for XSS safety (quotes become &#39;)
      expect(output).toContain("console.log(");
      expect(output).toContain("hello");
    });

    it("should handle thinking blocks", () => {
      const input =
        "Let me think...<thinking>This is my reasoning</thinking>Here's my answer.";
      const output = formatMarkdown(input);

      expect(output).toContain("thinking-block-container");
      expect(output).toContain("This is my reasoning");
    });

    it("should fix malformed code blocks with language on separate line", () => {
      const input = `# 📁 hello.py
python
def greet(name="Maria"): 
    """Greet someone by name."""
    return f"Hello, {name}!"

Example usage
if __name__ == "__main": 
    print(greet())`;
      const output = formatMarkdown(input);

      expect(output).toContain('<div class="code-block-container">');
      expect(output).toContain('data-language="python"');
      expect(output).toContain("def greet(name=");
      expect(output).toContain("if __name__ == ");
    });

    });
});
