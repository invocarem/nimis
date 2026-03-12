// test/vim.substitute.test.ts
import { VimToolManager } from "../src/utils/vim";
import { XmlProcessor } from "../src/utils/xmlProcessor";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);
const mkdir = promisify(fs.mkdir);

describe("VimToolManager - Simple Substitute Tests", () => {
  let manager: VimToolManager;
  let testDir: string;
  let testFile: string;

  beforeEach(async () => {
    testDir = path.join(__dirname, "temp_simple_sub_test");
    testFile = path.join(testDir, "test.txt");

    if (!fs.existsSync(testDir)) {
      await mkdir(testDir, { recursive: true });
    }

    manager = new VimToolManager(testDir);
  });

  afterEach(async () => {
    try {
      if (fs.existsSync(testFile)) {
        await unlink(testFile);
      }
    } catch (e) {
      // Ignore
    }
  });

  describe("Basic substitutions", () => {
    it("should replace text on current line with :s/old/new/", async () => {
      const content = "hello world\nfoo bar\nhello world\n";
      await writeFile(testFile, content, "utf-8");

      const result = await manager.callTool("vim", {
        file_path: testFile,
        commands: ["2G", ":s/foo/baz/", ":w"],
      });

      expect(result.isError).toBeFalsy();

      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toBe("hello world\nbaz bar\nhello world\n");
    });

    it("should replace all occurrences on line with :s/old/new/g", async () => {
      const content = "foo foo foo\nbar bar\nfoo foo\n";
      await writeFile(testFile, content, "utf-8");

      const result = await manager.callTool("vim", {
        file_path: testFile,
        commands: ["1G", ":s/foo/baz/g", ":w"],
      });

      expect(result.isError).toBeFalsy();

      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toBe("baz baz baz\nbar bar\nfoo foo\n");
    });

    it("should replace only first occurrence when 'g' flag is omitted", async () => {
      const content = "foo foo foo\n";
      await writeFile(testFile, content, "utf-8");

      const result = await manager.callTool("vim", {
        file_path: testFile,
        commands: [
          "1G",
          ":s/foo/baz/", // No 'g' flag - only first occurrence
          ":w",
        ],
      });

      expect(result.isError).toBeFalsy();

      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toBe("baz foo foo\n");
    });
  });

  describe("Range substitutions", () => {
    it("should replace in entire file with :%s/old/new/g", async () => {
      const content = "apple pie\nbanana split\napple tart\n";
      await writeFile(testFile, content, "utf-8");

      const result = await manager.callTool("vim", {
        file_path: testFile,
        commands: [":%s/apple/cherry/g", ":w"],
      });

      expect(result.isError).toBeFalsy();

      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toBe("cherry pie\nbanana split\ncherry tart\n");
    });

    it("should replace in a line range with :1,2s/old/new/g", async () => {
      const content = "line1: apple\nline2: apple\nline3: apple\n";
      await writeFile(testFile, content, "utf-8");

      const result = await manager.callTool("vim", {
        file_path: testFile,
        commands: [":1,2s/apple/orange/g", ":w"],
      });

      expect(result.isError).toBeFalsy();

      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toBe(
        "line1: orange\nline2: orange\nline3: apple\n"
      );
    });

    it("should replace from current line to end with :.,$s/old/new/g", async () => {
      const content = "line1\nline2\nline3\nline4\nline5\n";
      await writeFile(testFile, content, "utf-8");

      const result = await manager.callTool("vim", {
        file_path: testFile,
        commands: [
          "3G", // Go to line 3
          ":.,$s/line/ROW/g",
          ":w",
        ],
      });

      expect(result.isError).toBeFalsy();

      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toBe("line1\nline2\nROW3\nROW4\nROW5\n");
    });

    it("should replace from start to current line with :1,.s/old/new/g", async () => {
      const content = "line1\nline2\nline3\nline4\nline5\n";
      await writeFile(testFile, content, "utf-8");

      const result = await manager.callTool("vim", {
        file_path: testFile,
        commands: [
          "3G", // Go to line 3
          ":1,.s/line/ROW/g",
          ":w",
        ],
      });

      expect(result.isError).toBeFalsy();

      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toBe("ROW1\nROW2\nROW3\nline4\nline5\n");
    });
  });

  describe("Special characters and patterns", () => {
    it("should handle patterns with forward slashes by escaping them", async () => {
      const content = "path = /usr/local/bin\n";
      await writeFile(testFile, content, "utf-8");

      const result = await manager.callTool("vim", {
        file_path: testFile,
        commands: [":%s/\\/usr\\/local/\\/opt/g", ":w"],
      });

      expect(result.isError).toBeFalsy();

      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toBe("path = /opt/bin\n");
    });

    it("should handle patterns with forward slashes using # delimiter", async () => {
      const content = "path = /usr/local/bin\n";
      await writeFile(testFile, content, "utf-8");

      const result = await manager.callTool("vim", {
        file_path: testFile,
        commands: [":%s#/usr/local#/opt#g", ":w"],
      });

      expect(result.isError).toBeFalsy();

      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toBe("path = /opt/bin\n");
    });

    it("should handle patterns with forward slashes using | delimiter", async () => {
      const content = "path = /usr/local/bin\n";
      await writeFile(testFile, content, "utf-8");

      const result = await manager.callTool("vim", {
        file_path: testFile,
        commands: [":%s|/usr/local|/opt|g", ":w"],
      });

      expect(result.isError).toBeFalsy();

      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toBe("path = /opt/bin\n");
    });

    it("should handle patterns with forward slashes using @ delimiter", async () => {
      const content = "url = http://example.com/path\n";
      await writeFile(testFile, content, "utf-8");

      const result = await manager.callTool("vim", {
        file_path: testFile,
        commands: [":%s@http://example.com@https://new.example.com@g", ":w"],
      });

      expect(result.isError).toBeFalsy();

      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toBe("url = https://new.example.com/path\n");
    });

    it("should use alternative delimiter on current line with :s#old#new#", async () => {
      const content = "first/path\nsecond/path\nthird/path\n";
      await writeFile(testFile, content, "utf-8");

      const result = await manager.callTool("vim", {
        file_path: testFile,
        commands: ["2G", ":s#second/path#replaced#", ":w"],
      });

      expect(result.isError).toBeFalsy();

      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toBe("first/path\nreplaced\nthird/path\n");
    });

    it("should use alternative delimiter with line range :1,2s|old|new|g", async () => {
      const content = "a/b/c\na/b/c\na/b/c\n";
      await writeFile(testFile, content, "utf-8");

      const result = await manager.callTool("vim", {
        file_path: testFile,
        commands: [":1,2s|a/b|x/y|g", ":w"],
      });

      expect(result.isError).toBeFalsy();

      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toBe("x/y/c\nx/y/c\na/b/c\n");
    });

    it("should handle patterns with special regex characters", async () => {
      const content = "price: $10.99\ncost: $10.99\ntotal: $10.99\n";
      await writeFile(testFile, content, "utf-8");

      // $ and . are regex special characters, need escaping
      const result = await manager.callTool("vim", {
        file_path: testFile,
        commands: [":%s/\\$10\\.99/\\$15\\.99/g", ":w"],
      });

      expect(result.isError).toBeFalsy();

      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toBe(
        "price: $15.99\ncost: $15.99\ntotal: $15.99\n"
      );
    });

    it("should handle case-insensitive substitution with 'i' flag", async () => {
      const content = "Hello HELLO hello\n";
      await writeFile(testFile, content, "utf-8");

      const result = await manager.callTool("vim", {
        file_path: testFile,
        commands: [
          ":%s/hello/Hi/gi", // Case-insensitive, global
          ":w",
        ],
      });

      expect(result.isError).toBeFalsy();

      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toBe("Hi Hi Hi\n");
    });

    it("should replace tabs with spaces using :%s/\\t/    /g", async () => {
      const content = "\thello\n\t\tworld\n  spaces\n";
      await writeFile(testFile, content, "utf-8");

      const result = await manager.callTool("vim", {
        file_path: testFile,
        commands: [":%s/\\t/    /g", ":w"],
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Substituted 3 occurrence");

      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toBe("    hello\n        world\n  spaces\n");
    });

    it("should replace tabs when commands come from JSON.parse (tool call format)", async () => {
      const content = "\tdef foo():\n\t\tpass\n";
      await writeFile(testFile, content, "utf-8");

      // Simulate tool call args as parsed from JSON - JSON "\\t" becomes \t in the string
      const args = JSON.parse(
        '{"file_path":"test.txt","commands":[":e test.txt",":%s/\\t/    /g",":w"]}'
      );

      const result = await manager.callTool("vim", args);

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Substituted");

      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toContain("    def foo():");
      expect(updatedContent).toContain("        pass");
      expect(updatedContent).not.toContain("\t");
    });
  });

  describe("Complex replacements", () => {
    it("should handle multiple different substitutions in sequence", async () => {
      const content = "first second third\n";
      await writeFile(testFile, content, "utf-8");

      const result = await manager.callTool("vim", {
        file_path: testFile,
        commands: [":s/first/1/", ":s/second/2/", ":s/third/3/", ":w"],
      });

      expect(result.isError).toBeFalsy();

      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toBe("1 2 3\n");
    });

    it("should handle substitution with empty replacement", async () => {
      const content = "remove this word\n";
      await writeFile(testFile, content, "utf-8");

      const result = await manager.callTool("vim", {
        file_path: testFile,
        commands: [
          ":s/ this//", // Remove " this"
          ":w",
        ],
      });

      expect(result.isError).toBeFalsy();

      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toBe("remove word\n");
    });

    it("should handle substitution with numbers", async () => {
      const content = "item1, item2, item3\n";
      await writeFile(testFile, content, "utf-8");

      const result = await manager.callTool("vim", {
        file_path: testFile,
        commands: [":%s/item\\d+/product/g", ":w"],
      });

      expect(result.isError).toBeFalsy();

      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toBe("product, product, product\n");
    });
  });

  describe("Python code transformation", () => {
    it("should transform a Python function with multiple substitutions", async () => {
      const content = `def greet():
    print("Hello, World!")

def main():
    greet()
`;
      await writeFile(testFile, content, "utf-8");

      const result = await manager.callTool("vim", {
        file_path: testFile,
        commands: [
          ':%s/def greet[(][)]:/def greet(name="World"):/',
          ':%s/print[(]"Hello, World!"[)]/print(f"Hello, {name}")/',
          ":w",
        ],
      });

      expect(result.isError).toBeFalsy();

      const updatedContent = await readFile(testFile, "utf-8");
      const expectedContent = `def greet(name="World"):
    print(f"Hello, {name}")

def main():
    greet()
`;
      expect(updatedContent).toBe(expectedContent);
    });
  });

  describe("Edge cases and error handling", () => {
    it("should handle pattern not found gracefully", async () => {
      const content = "no matches here\n";
      await writeFile(testFile, content, "utf-8");

      const result = await manager.callTool("vim", {
        file_path: testFile,
        commands: [":s/nonexistent/replacement/g", ":w"],
      });

      // Should succeed but make no changes
      expect(result.isError).toBeFalsy();

      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toBe("no matches here\n");
    });

    it("should match literal | in pattern (Vim magic: | is literal, not alternation)", async () => {
      // Pattern "GLTX"| "ULRI"| "ULTX"| "UPRI" should match the full string literally.
      // Without fix: vimPatternToJs treats | as JS alternation -> only "GLTX" replaced -> FAIL.
      // With fix: unescaped | becomes \| in JS -> literal pipe -> full string replaced -> PASS.
      const content = [
        'const [activeNode, setActiveNode] = useState<',
        '    "GLTX"| "ULRI"| "ULTX"| "UPRI"',
        '  >("GLTX");',
      ].join("\n");
      await writeFile(testFile, content, "utf-8");

      const result = await manager.callTool("vim", {
        file_path: testFile,
        commands: ["2G", ':s/"GLTX"| "ULRI"| "ULTX"| "UPRI"/"UPRI" | "GLTX"/', ":w"],
      });

      expect(result.isError).toBeFalsy();
      const updatedContent = await readFile(testFile, "utf-8");
      const expected = [
        'const [activeNode, setActiveNode] = useState<',
        '    "UPRI" | "GLTX"',
        '  >("GLTX");',
      ].join("\n");
      expect(updatedContent).toBe(expected);
    });

    it("should report 0 substitutions when pattern does not match on target line (e.g. s on line 2 of useState snippet)", async () => {
      // Realistic case: LLM uses :s on line 2 with substitute input "GLTX" | "ULRI" | "ULTX" | "UPRI".
      // When | is used as delimiter, the pattern becomes "GLTX" (with trailing space). If the line
      // has no space before | (e.g. "GLTX"|), the pattern fails to match.
      const content = [
        'const [activeNode, setActiveNode] = useState<',
        '    "GLTX"| "ULRI"| "ULTX"| "UPRI"',
        '  >("GLTX");',
      ].join("\n");
      await writeFile(testFile, content, "utf-8");

      const result = await manager.callTool("vim", {
        file_path: testFile,
        commands: [ ':s/"GLTX"| "ULRI"| "ULTX"| "UPRI"/"UPRI" | "GLTX"/', ":w"],
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('"UPRI" | "GLTX"');

      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toBe(content);
    });

    it("should work when substitute comes through XML (LLM path) - no newline in command", async () => {
      // Simulate real flow: LLM sends tool call via XML, XmlProcessor extracts commands (split by newline).
      // If the substitute is on ONE line in CDATA, it must stay intact.
      const content = [
        'const [activeNode, setActiveNode] = useState<',
        '    "GLTX"| "ULRI"| "ULTX"| "UPRI"',
        '  >("GLTX");',
      ].join("\n");
      await writeFile(testFile, content, "utf-8");

      const toolCallXml = `<tool_call name="vim">
  <file_path>${testFile}</file_path>
  <commands><![CDATA[
:s/"GLTX"| "ULRI"| "ULTX"| "UPRI"/"UPRI" | "GLTX"/
:w
]]></commands>
</tool_call>`;

      const toolCalls = XmlProcessor.extractToolCalls(toolCallXml);
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].args.commands).toContain(':s/"GLTX"| "ULRI"| "ULTX"| "UPRI"/"UPRI" | "GLTX"/');

      const result = await manager.callTool("vim", {
        file_path: toolCalls[0].args.file_path,
        commands: toolCalls[0].args.commands,
      });

      expect(result.isError).toBeFalsy();
      const updatedContent = await readFile(testFile, "utf-8");
      // Substitute runs on current line (line 0) - no match, file unchanged
      expect(updatedContent).toBe(content);
    });

    it("REGRESSION: LLM may put newline in substitute for readability - breaks command split", async () => {
      // When LLM formats the substitute with a newline after | (for readability), xmlProcessor
      // splits commands by newline, breaking the substitute into invalid pieces.
      // :s/"GLTX"| becomes one "command", " "ULRI"|..." becomes another - substitute fails.
      const content = [
        'const [activeNode, setActiveNode] = useState<',
        '    "GLTX"| "ULRI"| "ULTX"| "UPRI"',
        '  >("GLTX");',
      ].join("\n");
      await writeFile(testFile, content, "utf-8");

      // LLM might format like this (newline after first |):
      const toolCallXml = `<tool_call name="vim">
  <file_path>${testFile}</file_path>
  <commands><![CDATA[
:s/"GLTX"|
 "ULRI"| "ULTX"| "UPRI"/"UPRI" | "GLTX"/
:w
]]></commands>
</tool_call>`;

      const toolCalls = XmlProcessor.extractToolCalls(toolCallXml);
      expect(toolCalls).toHaveLength(1);
      // Commands get split by newline - substitute is BROKEN into 2 commands
      const commands = toolCalls[0].args.commands;
      expect(commands).toContain(':s/"GLTX"|');
      expect(commands).toContain(' "ULRI"| "ULTX"| "UPRI"/"UPRI" | "GLTX"/');

      const result = await manager.callTool("vim", {
        file_path: toolCalls[0].args.file_path,
        commands: toolCalls[0].args.commands,
      });

      // First command :s/"GLTX"| is incomplete - substitute fails
      // File should remain unchanged (this is why "in reality it always fails")
      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toBe(content);
    });

    it("should handle invalid range gracefully", async () => {
      const content = "test content\n";
      await writeFile(testFile, content, "utf-8");

      const result = await manager.callTool("vim", {
        file_path: testFile,
        commands: [
          ":999,1000s/test/dummy/g", // Range beyond file
          ":w",
        ],
      });

      // Should handle error gracefully
      if (result.isError) {
        expect(result.content[0].text).toContain("range");
      } else {
        const updatedContent = await readFile(testFile, "utf-8");
        expect(updatedContent).toBe("test content\n");
      }
    });

    it("should handle empty pattern", async () => {
      const content = "test line\n";
      await writeFile(testFile, content, "utf-8");

      const result = await manager.callTool("vim", {
        file_path: testFile,
        commands: [
          ":s//dummy/", // Empty pattern
          ":w",
        ],
      });

      // Should either error or do nothing
      if (!result.isError) {
        const updatedContent = await readFile(testFile, "utf-8");
        expect(updatedContent).toBe("test line\n");
      }
    });
  });

  describe("Integration with other commands", () => {
    it("should work with marks", async () => {
      const content = "line1\nline2\nline3\nline4\nline5\n";
      await writeFile(testFile, content, "utf-8");

      const result = await manager.callTool("vim", {
        file_path: testFile,
        commands: [
          "2G",
          "ma", // Set mark a at line 2
          "4G",
          "mb", // Set mark b at line 4
          ":'a,'bs/line/ROW/g", // Substitute between marks
          ":w",
        ],
      });

      expect(result.isError).toBeFalsy();

      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toBe("line1\nROW2\nROW3\nROW4\nline5\n");
    });

    it("should work with global command", async () => {
      const content = "apple\nbanana\napple\ncherry\napple\n";
      await writeFile(testFile, content, "utf-8");

      const result = await manager.callTool("vim", {
        file_path: testFile,
        commands: [
          ":g/apple/s/apple/fruit/g", // On lines with apple, replace apple with fruit
          ":w",
        ],
      });

      expect(result.isError).toBeFalsy();

      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toBe("fruit\nbanana\nfruit\ncherry\nfruit\n");
    });

    it("should work with insert mode after substitution", async () => {
      const content = "TODO: implement function\n";
      await writeFile(testFile, content, "utf-8");

      const result = await manager.callTool("vim", {
        file_path: testFile,
        commands: [
          ":s/implement/implement/", // No change, just to position
          "A",
          " (urgent)",
          "\x1b",
          ":w",
        ],
      });

      expect(result.isError).toBeFalsy();

      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toBe("TODO: implement function (urgent)\n");
    });
  });

  describe("Vim regex pattern conversion", () => {
    it("should handle \\( \\) as capture groups with backreference", async () => {
      const content = "foo bar\nhello world\nbaz qux\n";
      await writeFile(testFile, content, "utf-8");

      const result = await manager.callTool("vim", {
        file_path: testFile,
        commands: [
          ':%s/^\\(.*\\)/    \\1/',
          ":w",
        ],
      });

      expect(result.isError).toBeFalsy();

      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toBe("    foo bar\n    hello world\n    baz qux\n");
    });

    it("should handle range substitute with \\( \\) capture groups", async () => {
      const content = "line1\nline2\nline3\nline4\nline5\n";
      await writeFile(testFile, content, "utf-8");

      const result = await manager.callTool("vim", {
        file_path: testFile,
        commands: [
          ':2,4s/^\\(.*\\)/  \\1/',
          ":w",
        ],
      });

      expect(result.isError).toBeFalsy();

      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toBe("line1\n  line2\n  line3\n  line4\nline5\n");
    });

    it("should handle range substitute without : prefix", async () => {
      const content = "aaa\nbbb\nccc\nddd\neee\n";
      await writeFile(testFile, content, "utf-8");

      const result = await manager.callTool("vim", {
        file_path: testFile,
        commands: [
          "2,4s/^/  /",
          ":w",
        ],
      });

      expect(result.isError).toBeFalsy();

      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toBe("aaa\n  bbb\n  ccc\n  ddd\neee\n");
    });

    it("should handle %print without : prefix", async () => {
      const content = "hello\nworld\n";
      await writeFile(testFile, content, "utf-8");

      const result = await manager.callTool("vim", {
        file_path: testFile,
        commands: ["%print"],
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("hello");
      expect(result.content[0].text).toContain("world");
    });
  });

  describe("Two-pattern range substitution", () => {
    it("should re-indent a function body using /start/,/end/s with Vim \\| alternation", async () => {
      const content = [
        "def add(a, b):",
        "    return a + b",
        "",
        "def divide(a, b):",
        '  """Return the quotient of a and b. Raises ValueError if b is zero."""',
        "  if b == 0:",
        '    raise ValueError("Cannot divide by zero")',
        "  return a / b",
        "",
        'if __name__ == "__main__":',
        "    print(add(1, 2))",
        "",
      ].join("\n");
      await writeFile(testFile, content, "utf-8");

      const result = await manager.callTool("vim", {
        file_path: testFile,
        commands: [
          ":/^def divide/,/^def \\|^if __/s/^  /    /g",
          ":w",
        ],
      });

      expect(result.isError).toBeFalsy();

      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toContain('    """Return the quotient');
      expect(updatedContent).toContain("    if b == 0:");
      expect(updatedContent).toContain(
        '      raise ValueError("Cannot divide by zero")'
      );
      expect(updatedContent).toContain("    return a / b");
      // Lines outside the range should be unchanged
      expect(updatedContent).toContain("def add(a, b):");
      expect(updatedContent).toContain("    return a + b");
    });
  });
});
