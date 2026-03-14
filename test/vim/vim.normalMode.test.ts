// test/vim.normalMode.test.ts
import { VimToolManager } from "../../src/utils/vim";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);
const mkdir = promisify(fs.mkdir);

describe("Normal Mode Commands - Isolated Tests", () => {
  let manager: VimToolManager;
  let testDir: string;
  let testFile: string;

  beforeEach(async () => {
    testDir = path.join(__dirname, "temp_normal_test");
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
      if (fs.existsSync(testDir)) {
        const files = await fs.promises.readdir(testDir);
        for (const file of files) {
          await unlink(path.join(testDir, file));
        }
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe("Movement commands", () => {
    beforeEach(async () => {
      const content = "line1\nline2\nline3\nline4\nline5\n";
      await writeFile(testFile, content, "utf-8");
      await manager.callTool("vim", { commands: [":e test.txt"] });
    });

    it("should handle '2G' command to go to line 2", async () => {
      const result = await manager.callTool("vim", {
        commands: ["2G"]
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Moved to line 2");

      // Verify by deleting current line and checking what gets deleted
      const deleteResult = await manager.callTool("vim", {
        commands: ["dd", ":w"]
      });

      expect(deleteResult.isError).toBeFalsy();
      const content = await readFile(testFile, "utf-8");
      expect(content).toBe("line1\nline3\nline4\nline5\n");
    });

    it("should handle 'G' command to go to last line", async () => {
      await manager.callTool("vim", {
        commands: ["G", "dd", ":w"]
      });

      const content = await readFile(testFile, "utf-8");
      expect(content).toBe("line1\nline2\nline3\nline4\n");
    });

    it("should handle 'gg' command to go to first line", async () => {
      await manager.callTool("vim", {
        commands: ["G", "gg", "dd", ":w"]
      });

      const content = await readFile(testFile, "utf-8");
      expect(content).toBe("line2\nline3\nline4\nline5\n");
    });

    it("should handle 'j' command to move down", async () => {
      await manager.callTool("vim", {
        commands: ["2j", "dd", ":w"]
      });

      const content = await readFile(testFile, "utf-8");
      expect(content).toBe("line1\nline2\nline4\nline5\n");
    });

    it("should handle 'k' command to move up", async () => {
      await manager.callTool("vim", {
        commands: ["G", "2k", "dd", ":w"]
      });

      const content = await readFile(testFile, "utf-8");
      expect(content).toBe("line1\nline2\nline4\nline5\n");
    });

    it("should handle '+' motion (move down to first non-blank)", async () => {
      const result = await manager.callTool("vim", {
        commands: ["+"]
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Moved down");
    });

    it("should handle '+1dd' to move down and delete line", async () => {
      await manager.callTool("vim", {
        commands: ["+1dd", ":w"]
      });

      const content = await readFile(testFile, "utf-8");
      // + moves from line1 to line2, 1dd deletes line2
      expect(content).toBe("line1\nline3\nline4\nline5\n");
    });

    it("should handle bare number to go to line N", async () => {
      const result = await manager.callTool("vim", {
        commands: ["3"]
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Moved to line 3");

      await manager.callTool("vim", {
        commands: ["dd", ":w"]
      });

      const content = await readFile(testFile, "utf-8");
      expect(content).toBe("line1\nline2\nline4\nline5\n");
    });

    it("should handle bare number in a command sequence", async () => {
      await manager.callTool("vim", {
        commands: ["4", "dd", ":w"]
      });

      const content = await readFile(testFile, "utf-8");
      expect(content).toBe("line1\nline2\nline3\nline5\n");
    });

    it("should handle '0' as move to beginning of line, not line 0", async () => {
      const result = await manager.callTool("vim", {
        commands: ["3l", "0"]
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Moved to beginning of line");
    });

    it("should error on bare number out of range", async () => {
      const result = await manager.callTool("vim", {
        commands: ["99"]
      });

      expect(result.isError).toBeTruthy();
    });
  });

  describe("Delete commands", () => {
    beforeEach(async () => {
      const content = "line1\nline2\nline3\nline4\nline5\n";
      await writeFile(testFile, content, "utf-8");
      await manager.callTool("vim", { commands: [":e test.txt"] });
    });

    it("should handle 'dd' to delete current line", async () => {
      await manager.callTool("vim", {
        commands: ["3G", "dd", ":w"]
      });

      const content = await readFile(testFile, "utf-8");
      expect(content).toBe("line1\nline2\nline4\nline5\n");
    });

    it("should handle '3dd' to delete 3 lines", async () => {
      await manager.callTool("vim", {
        commands: ["2G", "3dd", ":w"]
      });

      const content = await readFile(testFile, "utf-8");
      expect(content).toBe("line1\nline5\n");
    });

    it("should handle 'dd' with register", async () => {
      await manager.callTool("vim", {
        commands: [
          "2G",
          '"a',  // Select register a
          "dd",  // Delete to register a
          "G",   // Go to end
          '"a',  // Select register a
          "p",   // Put from register a
          ":w"
        ]
      });

      const content = await readFile(testFile, "utf-8");
      expect(content).toBe("line1\nline3\nline4\nline5\nline2\n");
    });

    it("should handle 'dD' to delete from cursor to end of line", async () => {
      const dDFile = path.join(testDir, "test_dD.txt");
      const content = "hello world\nfoo bar\n";
      await writeFile(dDFile, content, "utf-8");

      // Position cursor at column 5 (after "hello"), dD should delete " world"
      await manager.callTool("vim", {
        commands: [":e test_dD.txt", "5l", "dD", ":w"]
      });

      const updated = await readFile(dDFile, "utf-8");
      expect(updated).toBe("hello\nfoo bar\n");
    });
  });

  describe("Indent commands (>> and <<)", () => {
    beforeEach(async () => {
      const content = "  foo\n    bar\n  baz\n";
      await writeFile(testFile, content, "utf-8");
      await manager.callTool("vim", { commands: [":e test.txt"] });
    });

    it("should handle '>>' to indent current line right (prepend shiftwidth)", async () => {
      const result = await manager.callTool("vim", {
        commands: ["2G", ">>", ":w"]
      });

      expect(result.isError).toBeFalsy();
      const content = await readFile(testFile, "utf-8");
      // Default shiftwidth=8: "    bar" -> add 8 spaces -> "            bar"
      expect(content).toBe("  foo\n            bar\n  baz\n");
    });

    it("should handle '<<' to indent current line left (remove shiftwidth)", async () => {
      const result = await manager.callTool("vim", {
        commands: ["2G", "<<", ":w"]
      });

      expect(result.isError).toBeFalsy();
      const content = await readFile(testFile, "utf-8");
      // shiftwidth=8: remove up to 8 from "    bar" (4 spaces) -> "bar"
      expect(content).toBe("  foo\nbar\n  baz\n");
    });

    it("should handle '3>>' to indent 3 lines right", async () => {
      const result = await manager.callTool("vim", {
        commands: ["gg", "3>>", ":w"]
      });

      expect(result.isError).toBeFalsy();
      const content = await readFile(testFile, "utf-8");
      // Add 8 spaces to each: "  foo"->"          foo", "    bar"->"            bar", "  baz"->"          baz"
      expect(content).toBe("          foo\n            bar\n          baz\n");
    });

    it("should respect :set shiftwidth for >>", async () => {
      const result = await manager.callTool("vim", {
        commands: [":set shiftwidth=4", "2G", ">>", ":w"]
      });

      expect(result.isError).toBeFalsy();
      const content = await readFile(testFile, "utf-8");
      // shiftwidth=4: "    bar" -> add 4 spaces -> "        bar"
      expect(content).toBe("  foo\n        bar\n  baz\n");
    });
  });

  describe("Yank and put commands", () => {
    beforeEach(async () => {
      const content = "line1\nline2\nline3\nline4\nline5\n";
      await writeFile(testFile, content, "utf-8");
      await manager.callTool("vim", { commands: [":e test.txt"] });
    });

    it("should handle 'yy' to yank current line", async () => {
      await manager.callTool("vim", {
        commands: [
          "2G",
          "yy",
          "G",
          "p",
          ":w"
        ]
      });

      const content = await readFile(testFile, "utf-8");
      expect(content).toBe("line1\nline2\nline3\nline4\nline5\nline2\n");
    });

    it("should handle '2yy' to yank 2 lines", async () => {
      await manager.callTool("vim", {
        commands: [
          "2G",
          "2yy",
          "G",
          "p",
          ":w"
        ]
      });

      const content = await readFile(testFile, "utf-8");
      expect(content).toBe("line1\nline2\nline3\nline4\nline5\nline2\nline3\n");
    });

    it("should handle 'yy' with named register", async () => {
      await manager.callTool("vim", {
        commands: [
          "2G",
          '"a',  // Select register a
          "yy",  // Yank line 2 to register a
          "3G",
          '"b',  // Select register b
          "yy",  // Yank line 3 to register b
          "G",
          '"a',  // Select register a
          "p",   // Put from register a
          '"b',  // Select register b
          "p",   // Put from register b
          ":w"
        ]
      });

      const content = await readFile(testFile, "utf-8");
      expect(content).toBe("line1\nline2\nline3\nline4\nline5\nline2\nline3\n");
    });

    it("should handle 'p' to put after cursor", async () => {
      await manager.callTool("vim", {
        commands: [
          "2G",
          "yy",
          "p",
          ":w"
        ]
      });

      const content = await readFile(testFile, "utf-8");
      expect(content).toBe("line1\nline2\nline2\nline3\nline4\nline5\n");
    });

    it("should handle 'P' to put before cursor", async () => {
      await manager.callTool("vim", {
        commands: [
          "2G",
          "yy",
          "P",
          ":w"
        ]
      });

      const content = await readFile(testFile, "utf-8");
      expect(content).toBe("line1\nline2\nline2\nline3\nline4\nline5\n");
    });

    it("should handle multiple puts with count", async () => {
      await manager.callTool("vim", {
        commands: [
          "2G",
          "yy",
          "3p",
          ":w"
        ]
      });

      const content = await readFile(testFile, "utf-8");
      expect(content).toBe("line1\nline2\nline2\nline2\nline2\nline3\nline4\nline5\n");
    });
  });

  describe("Register persistence", () => {
    it("should persist registers across multiple vim calls", async () => {
      const content = "line1\nline2\nline3\n";
      await writeFile(testFile, content, "utf-8");

      // First call: open file and yank to register a
      await manager.callTool("vim", {
        commands: [":e test.txt", "2G", '"a', "yy"]
      });

      // Second call: use register a
      const result = await manager.callTool("vim", {
        commands: ["G", '"a', "p", ":w"]
      });

      expect(result.isError).toBeFalsy();
      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toBe("line1\nline2\nline3\nline2\n");
    });

    it("should maintain unnamed register", async () => {
      await writeFile(testFile, "test\n", "utf-8");

      await manager.callTool("vim", {
        commands: [":e test.txt", "yy"]  // Yank to unnamed register
      });

      await manager.callTool("vim", {
        commands: ["p", ":w"]
      });

      const content = await readFile(testFile, "utf-8");
      expect(content).toBe("test\ntest\n");
    });
  });

  describe("Complex command sequences", () => {
    it("should handle '2Gdd' as a single command", async () => {
      const content = "line1\nline2\nline3\nline4\nline5\n";
      await writeFile(testFile, content, "utf-8");

      await manager.callTool("vim", {
        commands: [":e test.txt", "2Gdd", ":w"]
      });

      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toBe("line1\nline3\nline4\nline5\n");
    });

    it("should handle '3G2dd' to delete 2 lines starting from line 3", async () => {
      const content = "line1\nline2\nline3\nline4\nline5\n";
      await writeFile(testFile, content, "utf-8");

      await manager.callTool("vim", {
        commands: [":e test.txt", "3G2dd", ":w"]
      });

      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toBe("line1\nline2\nline5\n");
    });
  });

  describe(":normal ex command", () => {
    it("should handle ':normal o' to add a new line after cursor and stay in normal mode", async () => {
      const content = "line1\nline2\nline3\n";
      await writeFile(testFile, content, "utf-8");

      const result = await manager.callTool("vim", {
        commands: [":e test.txt", "2G", ":normal o", ":w"]
      });

      expect(result.isError).toBeFalsy();
      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toBe("line1\nline2\n\nline3\n");
    });
  });

  describe("Error cases", () => {
    it("should handle deleting beyond file end", async () => {
      const content = "line1\nline2\n";
      await writeFile(testFile, content, "utf-8");

      const result = await manager.callTool("vim", {
        commands: [":e test.txt", "G", "5dd", ":w"]
      });

      expect(result.isError).toBeFalsy(); // Should delete only existing lines
      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toBe("line1\n");
    });

    it("should handle moving cursor beyond file bounds", async () => {
      const content = "line1\n";
      await writeFile(testFile, content, "utf-8");

      const result = await manager.callTool("vim", {
        commands: [":e test.txt", "10j", "dd", ":w"]
      });

      expect(result.isError).toBeFalsy(); // Should stay at last line
      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toBe(""); // Should delete the only line
    });
  });
});