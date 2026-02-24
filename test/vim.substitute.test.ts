// test/vim.substitute.test.ts
import { VimToolManager } from "../src/utils/vim";
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

      const result = await manager.callTool("vim_edit", {
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

      const result = await manager.callTool("vim_edit", {
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

      const result = await manager.callTool("vim_edit", {
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

      const result = await manager.callTool("vim_edit", {
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

      const result = await manager.callTool("vim_edit", {
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

      const result = await manager.callTool("vim_edit", {
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

      const result = await manager.callTool("vim_edit", {
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

      const result = await manager.callTool("vim_edit", {
        file_path: testFile,
        commands: [":%s/\\/usr\\/local/\\/opt/g", ":w"],
      });

      expect(result.isError).toBeFalsy();

      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toBe("path = /opt/bin\n");
    });

    it("should handle patterns with forward slashes using different delimiter", async () => {
      const content = "path = /usr/local/bin\n";
      await writeFile(testFile, content, "utf-8");

      // Using backslash as delimiter instead of forward slash
      const result = await manager.callTool("vim_edit", {
        file_path: testFile,
        commands: [":%s\\/usr/local\\/opt", ":w"],
      });

      expect(result.isError).toBeFalsy();

      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toBe("path = /opt/bin\n");
    });

    it("should handle patterns with special regex characters", async () => {
      const content = "price: $10.99\ncost: $10.99\ntotal: $10.99\n";
      await writeFile(testFile, content, "utf-8");

      // $ and . are regex special characters, need escaping
      const result = await manager.callTool("vim_edit", {
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

      const result = await manager.callTool("vim_edit", {
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
  });

  describe("Complex replacements", () => {
    it("should handle multiple different substitutions in sequence", async () => {
      const content = "first second third\n";
      await writeFile(testFile, content, "utf-8");

      const result = await manager.callTool("vim_edit", {
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

      const result = await manager.callTool("vim_edit", {
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

      const result = await manager.callTool("vim_edit", {
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

      const result = await manager.callTool("vim_edit", {
        file_path: testFile,
        commands: [
          // Escape () in pattern so they match literally (Vim-style: \( \) in pattern)
          ':%s/def greet\\(\\):/def greet(name="World"):/',
          ':%s/print\\("Hello, World!"\\)/print(f"Hello, {name}")/',
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

      const result = await manager.callTool("vim_edit", {
        file_path: testFile,
        commands: [":s/nonexistent/replacement/g", ":w"],
      });

      // Should succeed but make no changes
      expect(result.isError).toBeFalsy();

      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toBe("no matches here\n");
    });

    it("should handle invalid range gracefully", async () => {
      const content = "test content\n";
      await writeFile(testFile, content, "utf-8");

      const result = await manager.callTool("vim_edit", {
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

      const result = await manager.callTool("vim_edit", {
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

      const result = await manager.callTool("vim_edit", {
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

      const result = await manager.callTool("vim_edit", {
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

      const result = await manager.callTool("vim_edit", {
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
});
