// Converted from Chai to Jest
import {
  LLMResponseProcessor,
  formatLLMOutput,
} from "../src/utils/llmResponseProcessor";

describe("LLMResponseProcessor", () => {
  describe("format", () => {
    const processor = new LLMResponseProcessor();
    describe("Code Blocks", () => {
      it("should format code blocks with language identifier", () => {
        const input =
          "Here is some code:\n```javascript\nconst x = 5;\nconsole.log(x);\n```";
        const output = processor.format(input);

        expect(output).toContain('<div class="code-block-container">');
        expect(output).toContain('data-language="javascript"');
        expect(output).toContain("const x = 5;");
        expect(output).toContain("console.log(x);");
      });

      it("should format code blocks without language identifier", () => {
        const input = "```\nsome code\n```";
        const output = processor.format(input);

        expect(output).toContain('<pre class="code-block"');
        expect(output).toContain("some code");
      });

      it("should format multiple code blocks", () => {
        const input = "```js\ncode1\n```\nSome text\n```python\ncode2\n```";
        const output = processor.format(input);

        expect(output).toContain('data-language="js"');
        expect(output).toContain('data-language="python"');
        expect(output).toContain("code1");
        expect(output).toContain("code2");
      });

      it("should format and prettify JSON code blocks", () => {
        const input = '```json\n{"name":"test","value":123}\n```';
        const output = processor.format(input);

        expect(output).toContain('data-language="json"');
        expect(output).toContain("&quot;name&quot;");
        expect(output).toContain("&quot;test&quot;");
        // Should be prettified with indentation
        expect(output).toMatch(/\s+&quot;name&quot;/);
      });

      it("should auto-detect and format JSON without language tag", () => {
        const input = '```\n{"name":"test"}\n```';
        const output = processor.format(input);

        expect(output).toContain('data-language="json"');
        expect(output).toContain("&quot;name&quot;");
      });

      it("should add copy button to code blocks", () => {
        const input = "```javascript\nconst x = 5;\n```";
        const output = processor.format(input);

        expect(output).toContain('class="copy-button"');
        expect(output).toContain("Copy");
      });

      it("should escape HTML in code blocks", () => {
        const input = '```\n<script>alert("xss")</script>\n```';
        const output = processor.format(input);

        expect(output).toContain("&lt;script&gt;");
        expect(output).toContain("&lt;/script&gt;");
        expect(output).not.toContain("<script>alert");
      });
    });

    describe("Inline Code", () => {
      it("should format inline code with backticks", () => {
        const input = "Use the `console.log()` function";
        const output = processor.format(input);

          expect(output).toContain('<code class="inline-code">console.log()</code>');
      });

      it("should format multiple inline code snippets", () => {
        const input = "Variables like `x` and `y` are important";
        const output = processor.format(input);

          expect(output).toContain('<code class="inline-code">x</code>');
          expect(output).toContain('<code class="inline-code">y</code>');
      });

      it("should not confuse inline code with code blocks", () => {
        const input = "Inline `code` and\n```\nblock code\n```";
        const output = processor.format(input);

          expect(output).toContain('<code class="inline-code">code</code>');
          expect(output).toContain('<pre class="code-block"');
      });
    });

    describe("Text Formatting", () => {
      it("should format bold text with double asterisks", () => {
        const input = "This is **bold** text";
        const output = processor.format(input);

          expect(output).toContain("<strong>bold</strong>");
      });

      it("should format bold text with double underscores", () => {
        const input = "This is __bold__ text";
        const output = processor.format(input);

          expect(output).toContain("<strong>bold</strong>");
      });

      it("should format italic text with single asterisks", () => {
        const input = "This is *italic* text";
        const output = processor.format(input);

          expect(output).toContain("<em>italic</em>");
      });

      it("should format italic text with single underscores", () => {
        const input = "This is _italic_ text";
        const output = processor.format(input);

          expect(output).toContain("<em>italic</em>");
      });

      it("should format combined bold and italic", () => {
        const input = "This is **bold** and *italic* text";
        const output = processor.format(input);

          expect(output).toContain("<strong>bold</strong>");
          expect(output).toContain("<em>italic</em>");
      });
    });

    describe("Headers", () => {
      it("should format H1 headers", () => {
        const input = "# Header 1\nSome text";
        const output = processor.format(input);

          expect(output).toContain("<h1>Header 1</h1>");
      });

      it("should format H2 headers", () => {
        const input = "## Header 2\nSome text";
        const output = processor.format(input);

          expect(output).toContain("<h2>Header 2</h2>");
      });

      it("should format H3 headers", () => {
        const input = "### Header 3\nSome text";
        const output = processor.format(input);

          expect(output).toContain("<h3>Header 3</h3>");
      });

      it("should format multiple headers", () => {
        const input = "# Title\n## Subtitle\n### Section";
        const output = processor.format(input);

          expect(output).toContain("<h1>Title</h1>");
          expect(output).toContain("<h2>Subtitle</h2>");
          expect(output).toContain("<h3>Section</h3>");
      });
    });

    describe("Lists", () => {
      it("should format unordered lists with asterisks", () => {
        const input = "* Item 1\n* Item 2\n* Item 3";
        const output = processor.format(input);

        expect(output).toContain("Item 1");
        expect(output).toContain("Item 2");
        expect(output).toContain("Item 3");
        expect(output).toContain('<li class="list-item"');
        expect(output).toContain("<ul>");
      });

      it("should format unordered lists with hyphens", () => {
        const input = "- Item 1\n- Item 2";
        const output = processor.format(input);

        expect(output).toContain("Item 1");
        expect(output).toContain("Item 2");
        expect(output).toContain('<li class="list-item"');
        expect(output).toContain("<ul>");
      });

      it("should format unordered lists with plus signs", () => {
        const input = "+ Item 1\n+ Item 2";
        const output = processor.format(input);

        expect(output).toContain("Item 1");
        expect(output).toContain("Item 2");
        expect(output).toContain('<li class="list-item"');
        expect(output).toContain("<ul>");
      });

      it("should format ordered lists", () => {
        const input = "1. First\n2. Second\n3. Third";
        const output = processor.format(input);

        expect(output).toContain("First");
        expect(output).toContain("Second");
        expect(output).toContain("Third");
        expect(output).toContain('<li class="list-item ordered"');
        expect(output).toContain("<ol>");
      });
    });

    describe("Links", () => {
      it("should format markdown links", () => {
        const input = "Check out [this link](https://example.com)";
        const output = processor.format(input);

        expect(output).toContain('<a href="https://example.com" target="_blank">this link</a>');
      });

      it("should format multiple links", () => {
        const input = "[Link 1](http://one.com) and [Link 2](http://two.com)";
        const output = processor.format(input);

        expect(output).toContain('<a href="http://one.com" target="_blank">Link 1</a>');
        expect(output).toContain('<a href="http://two.com" target="_blank">Link 2</a>');
      });
    });

    describe("Paragraphs", () => {
      it("should wrap text in paragraph tags", () => {
        const input = "This is a paragraph";
        const output = processor.format(input);

        expect(output).toContain("<p>");
        expect(output).toContain("</p>");
      });

      it("should handle multiple paragraphs", () => {
        const input = "Paragraph 1\n\nParagraph 2";
        const output = processor.format(input);

        expect(output).toContain("Paragraph 1");
        expect(output).toContain("Paragraph 2");
        expect(output).toMatch(/<\/p>.*<p>/);
      });
    });

    describe("XSS Prevention", () => {
      it("should escape HTML tags in text", () => {
        const input = '<script>alert("xss")</script>';
        const output = processor.format(input);

          expect(output).toContain("&lt;script&gt;");
          expect(output).toContain("&lt;/script&gt;");
          expect(output).not.toContain("<script>");
      });

      it("should escape HTML entities", () => {
        const input = "Code: <div>content</div>";
        const output = processor.format(input);

          expect(output).toContain("&lt;div&gt;");
          expect(output).toContain("&lt;/div&gt;");
      });

      it("should escape special characters", () => {
        const input = "Quotes: \" and ' and & symbol";
        const output = processor.format(input);

          expect(output).toContain("&quot;");
          expect(output).toContain("&#39;");
          expect(output).toContain("&amp;");
      });
    });

    describe("Complex Content", () => {
      it("should handle mixed content types", () => {
        const input = `# Title
        
This is **bold** and *italic* text with \`inline code\`.


\`\`\`javascript
const x = 5;
\`\`\`

Check out [this link](https://example.com).`;

        const output = processor.format(input);

        expect(output).toContain("<h1>Title</h1>");
        expect(output).toContain("<strong>bold</strong>");
        expect(output).toContain("<em>italic</em>");
        expect(output).toContain('<code class="inline-code">inline code</code>');
        expect(output).toContain('data-language="javascript"');
        expect(output).toContain('<a href="https://example.com"');
      });

      it("should handle empty input", () => {
        const input = "";
        const output = processor.format(input);

        expect(typeof output).toBe("string");
      });

      it("should handle code blocks with empty lines", () => {
        const input = "```javascript\nconst x = 5;\n\nconsole.log(x);\n```";
        const output = processor.format(input);

          expect(output).toContain("const x = 5;");
          expect(output).toContain("console.log(x);");
      });
    });

    describe("Options", () => {
      it("should respect enableMarkdown option when false", () => {
        const input = "**bold** text";
        const output = new LLMResponseProcessor({
          enableMarkdown: false,
        }).format(input);

        // Should not format markdown when disabled
        expect(output).not.toContain("<strong>");
      });

      it("should respect enableSyntaxHighlight option", () => {
        const input = "```js\ncode\n```";
        const output = new LLMResponseProcessor({
          enableSyntaxHighlight: true,
        }).format(input);

        expect(output).toContain('data-language="js"');
      });

      it("should respect enableJsonFormatting option", () => {
        const input = '```json\n{"test": 123}\n```';
        const output = new LLMResponseProcessor({
          enableJsonFormatting: true,
        }).format(input);

        expect(output).toContain("&quot;test&quot;");
      });
    });

    describe("Edge Cases", () => {
      it("should handle single backtick in text", () => {
        const input = "This has a ` backtick";
        const output = processor.format(input);

        expect(typeof output).toBe("string");
      });

      it("should handle incomplete markdown syntax", () => {
        const input = "**bold without closing";
        const output = processor.format(input);

        expect(typeof output).toBe("string");
      });

      it("should handle nested formatting", () => {
        const input = "**bold with `code` inside**";
        const output = processor.format(input);

        expect(output).toContain("<strong>");
        expect(output).toContain("code");
      });

      it("should handle special regex characters in text", () => {
        const input = "Regex: .*+?[]{}()";
        const output = processor.format(input);

        expect(typeof output).toBe("string");
        expect(output).toContain(".*+?[]{}()");
      });

      it("should handle very long code blocks", () => {
        const longCode = "a".repeat(10000);
        const input = `\`\`\`javascript\n${longCode}\n\`\`\``;
        const output = processor.format(input);

        expect(output).toContain(longCode);
        expect(output).toContain('data-language="javascript"');
      });

      it("should handle unicode characters", () => {
        const input = "这是中文 **粗体** 文字 `代码` 😀";
        const output = processor.format(input);

        expect(output).toContain("这是中文");
        expect(output).toContain("<strong>粗体</strong>");
        expect(output).toContain('<code class="inline-code">代码</code>');
        expect(output).toContain("😀");
      });

      it("should preprocess and fix malformed LLM markdown", () => {
        const input = `## Python Hello Module Implementation
Here's a complete hello.py module that meets both requirements:
python# hello.py
def greet(name):
    """Print a greeting message."""
    print(f"Hello, {name}!")

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="A simple greeting program.")
    parser.add_argument("--name", type=str, default="World", help="Name of the person to greet")
    args = parser.parse_args()
    greet(args.name)

Usage Examples:
Basic usage (default):
bashpython hello.py
# Output: Hello, World!

With custom name:
bashpython hello.py --name Maria
# Output: Hello, Maria!`;

        const output = processor.format(input);

        // Should contain properly formatted code blocks
        expect(output).toContain('<div class="code-block-container">');
        expect(output).toContain('data-language="python"');
        expect(output).toContain('data-language="bash"');
        expect(output).toContain("def greet(name):");
        expect(output).toContain("python hello.py");
        expect(output).toContain("--name Maria");
      });

      it("should not close code block on blank line between two functions (preprocess)", () => {
        // Simulates LLM output: one code block with two functions and a blank line between them.
        // Preprocess must NOT insert ``` after the blank line (bug: empty nextLine was closing the block).
        const input = `\`\`\`python
def sine(x):
    return math.sin(x)

def cosine(x):
    return math.cos(x)
\`\`\``;
        const preprocessed = LLMResponseProcessor.preprocess(input);
        expect(preprocessed).toContain("def sine(x):");
        expect(preprocessed).toContain("def cosine(x):");
        // Both functions must appear in one block: no extra ``` between them (erroneous early close).
        expect(preprocessed).not.toMatch(/```\s*\n\s*def cosine/);
        // Second function should be present after the first (same block).
        expect(preprocessed).toMatch(/def sine[\s\S]*def cosine/);
      });

      it("should preprocess concatenated LLM output with no line breaks", () => {
        const input = `Alright! Let me create a simple hello.py script that greets Maria.python# hello.pydef greet(name): """Returns a greeting message for the given name.""" return f"Hello, {name}!"if __name__ == "__main__": # Greet Maria when run as a script print(greet("Maria"))This creates:- A reusable greet() function- Direct execution when running the file- Clean output: "Hello, Maria!"`;

        const output = processor.format(input);

        // Should properly separate code from text
        expect(output).toContain('<div class="code-block-container">');
        expect(output).toContain('data-language="python"');
        expect(output).toContain("def greet(name):");
        expect(output).toContain("This creates:");
        // Code should be in a separate block from the explanation
        expect(output).not.toContain("def greet(name):This creates:");
        // Code should have proper line breaks
        expect(output).toContain("# hello.py");
        expect(output).toContain("def greet(name):");
      });
    });

    describe("Thinking Blocks", () => {
      it("should format <think> blocks with collapsible container", () => {
        const input =
          "Here's my answer. <think>Let me reason about this...</think>";
        const output = processor.format(input);

        expect(output).toContain('class="thinking-block-container"');
        expect(output).toContain("Let me reason about this...");
        expect(output).toContain("Here&#39;s my answer.");
      });

      it("should format <thinking> blocks with collapsible container", () => {
        const input =
          "<thinking>Internal reasoning here</thinking>\nMy response";
        const output = processor.format(input);

        expect(output).toContain('class="thinking-block-container"');
        expect(output).toContain("Internal reasoning here");
        expect(output).toContain("My response");
      });

      it("should handle multiple thinking blocks", () => {
        const input =
          "<think>First thought</think>\nAnswer 1\n<think>Second thought</think>\nAnswer 2";
        const output = processor.format(input);

        expect(output).toContain("First thought");
        expect(output).toContain("Second thought");
        expect(output).toContain("Answer 1");
        expect(output).toContain("Answer 2");
      });

      it("should support markdown inside thinking blocks", () => {
        const input = "<think>I need to **consider** this `carefully`</think>";
        const output = processor.format(input);

        expect(output).toContain('class="thinking-block-container"');
        expect(output).toContain("<strong>consider</strong>");
        expect(output).toContain('<code class="inline-code">carefully</code>');
      });

      it("should handle multiline thinking blocks", () => {
        const input = `<think>
Step 1: Analyze the problem
Step 2: Consider options
Step 3: Choose solution
</think>`;
        const output = processor.format(input);

        expect(output).toContain('class="thinking-block-container"');
        expect(output).toContain("Step 1");
        expect(output).toContain("Step 2");
        expect(output).toContain("Step 3");
      });

      it("should add toggle functionality elements", () => {
        const input = "<think>Hidden reasoning</think>";
        const output = processor.format(input);

        expect(output).toContain('class="thinking-block-container"');
        expect(output).toContain('class="thinking-header"');
        expect(output).toContain('class="thinking-content"');
      });

      it("should escape HTML in thinking blocks", () => {
        const input = '<think><script>alert("xss")</script></think>';
        const output = processor.format(input);

        expect(output).toContain("&lt;script&gt;");
        expect(output).toContain("&lt;/script&gt;");
        expect(output).not.toContain("<script>alert");
      });

      it("should handle thinking blocks mixed with code blocks", () => {
        const input =
          "<think>Let me write some code</think>\n```js\nconst x = 5;\n```";
        const output = processor.format(input);

        expect(output).toContain('class="thinking-block-container"');
        expect(output).toContain('class="code-block-container"');
        expect(output).toContain("Let me write some code");
        expect(output).toContain("const x = 5;");
      });

      it("should handle empty thinking blocks", () => {
        const input = "<think></think>";
        const output = processor.format(input);

        expect(output).toContain('class="thinking-block-container"');
      });

      it("should handle unclosed thinking tags gracefully", () => {
        const input = "<think>Incomplete thought";
        const output = processor.format(input);

        // Should not break the formatter
        expect(typeof output).toBe("string");
        expect(output).toContain("Incomplete thought");
      });

      it("should parse Harmony protocol messages and format the final message", () => {
        const input =
          "<|start|>assistant<|channel|>final<|message|>Hello! I'm here to help.<|end|>";
        const output = processor.format(input);

        expect(output).toContain("Hello! I&#39;m here to help.");
        expect(output).not.toContain("<|start|>");
        expect(output).not.toContain("<|end|>");
      });

      it("should handle plain text when no Harmony tags are present", () => {
        const input = "This is plain text.";
        const output = processor.format(input);

        expect(output).toContain("This is plain text.");
      });
    });
  });
});
