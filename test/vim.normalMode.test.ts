// test/vim.normalMode.test.ts
import { VimToolManager } from "../src/utils/vim";
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
      await manager.callTool("vim_edit", { file_path: testFile, commands: [] });
    });

    it("should handle '2G' command to go to line 2", async () => {
      const result = await manager.callTool("vim_edit", {
        file_path: testFile,
        commands: ["2G"]
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Moved to line 2");

      // Verify by deleting current line and checking what gets deleted
      const deleteResult = await manager.callTool("vim_edit", {
        file_path: testFile,
        commands: ["dd", ":w"]
      });

      expect(deleteResult.isError).toBeFalsy();
      const content = await readFile(testFile, "utf-8");
      expect(content).toBe("line1\nline3\nline4\nline5\n");
    });

    it("should handle 'G' command to go to last line", async () => {
      await manager.callTool("vim_edit", {
        file_path: testFile,
        commands: ["G", "dd", ":w"]
      });

      const content = await readFile(testFile, "utf-8");
      expect(content).toBe("line1\nline2\nline3\nline4\n");
    });

    it("should handle 'gg' command to go to first line", async () => {
      await manager.callTool("vim_edit", {
        file_path: testFile,
        commands: ["G", "gg", "dd", ":w"]
      });

      const content = await readFile(testFile, "utf-8");
      expect(content).toBe("line2\nline3\nline4\nline5\n");
    });

    it("should handle 'j' command to move down", async () => {
      await manager.callTool("vim_edit", {
        file_path: testFile,
        commands: ["2j", "dd", ":w"]
      });

      const content = await readFile(testFile, "utf-8");
      expect(content).toBe("line1\nline2\nline4\nline5\n");
    });

    it("should handle 'k' command to move up", async () => {
      // First, verify the initial state
      await manager.callTool("vim_edit", {
        file_path: testFile,
        commands: [] // Just load the file
      });

      // Move to last line, then up 2 lines, then delete current line
      const result = await manager.callTool("vim_edit", {
        file_path: testFile,
        commands: ["G", "2k", "dd", ":w"]
      });

      expect(result.isError).toBeFalsy();

      // Read the file and verify content
      const content = await readFile(testFile, "utf-8");
      console.log('Content after k test:', content); // Debug log

      // After moving to line 5 (G), then up 2 (k,k), we should be at line 3
      // Deleting line 3 should leave lines 1,2,4,5
      expect(content).toBe("line1\nline2\nline4\nline5\n");
    });
  });

  describe("Delete commands", () => {
    beforeEach(async () => {
      const content = "line1\nline2\nline3\nline4\nline5\n";
      await writeFile(testFile, content, "utf-8");
      await manager.callTool("vim_edit", { file_path: testFile, commands: [] });
    });

    it("should handle 'dd' to delete current line", async () => {
      await manager.callTool("vim_edit", {
        file_path: testFile,
        commands: ["3G", "dd", ":w"]
      });

      const content = await readFile(testFile, "utf-8");
      expect(content).toBe("line1\nline2\nline4\nline5\n");
    });

    it("should handle '3dd' to delete 3 lines", async () => {
      await manager.callTool("vim_edit", {
        file_path: testFile,
        commands: ["2G", "3dd", ":w"]
      });

      const content = await readFile(testFile, "utf-8");
      expect(content).toBe("line1\nline5\n");
    });

    it("should handle 'dd' with register", async () => {
      await manager.callTool("vim_edit", {
        file_path: testFile,
        commands: [
          "2G",
          '"add', // Delete line 2 to register a
          "G",    // Go to end
          '"ap',  // Put from register a
          ":w"
        ]
      });

      const content = await readFile(testFile, "utf-8");
      expect(content).toBe("line1\nline3\nline4\nline5\nline2\n");
    });
  });

  describe("Yank and put commands", () => {
    beforeEach(async () => {
      const content = "line1\nline2\nline3\nline4\nline5\n";
      await writeFile(testFile, content, "utf-8");
      await manager.callTool("vim_edit", { file_path: testFile, commands: [] });
    });

    it("should handle 'yy' to yank current line", async () => {
      await manager.callTool("vim_edit", {
        file_path: testFile,
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
      await manager.callTool("vim_edit", {
        file_path: testFile,
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
      await manager.callTool("vim_edit", {
        file_path: testFile,
        commands: [
          "2G",
          '"ayy',  // Yank line 2 to register a
          "3G",
          '"byy',  // Yank line 3 to register b
          "G",
          '"ap',   // Put from register a
          '"bp',   // Put from register b
          ":w"
        ]
      });

      const content = await readFile(testFile, "utf-8");
      expect(content).toBe("line1\nline2\nline3\nline4\nline5\nline2\nline3\n");
    });

    it("should handle 'p' to put after cursor", async () => {
      await manager.callTool("vim_edit", {
        file_path: testFile,
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
      await manager.callTool("vim_edit", {
        file_path: testFile,
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
      await manager.callTool("vim_edit", {
        file_path: testFile,
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
    it("should persist registers across multiple vim_edit calls", async () => {
      const content = "line1\nline2\nline3\n";
      await writeFile(testFile, content, "utf-8");

      // First call: yank to register a
      await manager.callTool("vim_edit", {
        file_path: testFile,
        commands: ["2G", '"ayy']
      });

      // Second call: use register a
      const result = await manager.callTool("vim_edit", {
        file_path: testFile,
        commands: ["G", '"ap', ":w"]
      });

      expect(result.isError).toBeFalsy();
      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toBe("line1\nline2\nline3\nline2\n");
    });

    it("should maintain unnamed register", async () => {
      await writeFile(testFile, "test\n", "utf-8");

      await manager.callTool("vim_edit", {
        file_path: testFile,
        commands: ["yy"]  // Yank to unnamed register
      });

      await manager.callTool("vim_edit", {
        file_path: testFile,
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

      await manager.callTool("vim_edit", {
        file_path: testFile,
        commands: ["2Gdd", ":w"]
      });

      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toBe("line1\nline3\nline4\nline5\n");
    });

    it("should handle '3G2dd' to delete 2 lines starting from line 3", async () => {
      const content = "line1\nline2\nline3\nline4\nline5\n";
      await writeFile(testFile, content, "utf-8");

      await manager.callTool("vim_edit", {
        file_path: testFile,
        commands: ["3G2dd", ":w"]
      });

      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toBe("line1\nline2\nline5\n");
    });
  });

  describe("Error cases", () => {
    it("should handle deleting beyond file end", async () => {
      const content = "line1\nline2\n";
      await writeFile(testFile, content, "utf-8");

      const result = await manager.callTool("vim_edit", {
        file_path: testFile,
        commands: ["G", "5dd", ":w"]
      });

      expect(result.isError).toBeFalsy(); // Should delete only existing lines
      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toBe("line1\n");
    });

    it("should handle moving cursor beyond file bounds", async () => {
      const content = "line1\n";
      await writeFile(testFile, content, "utf-8");

      const result = await manager.callTool("vim_edit", {
        file_path: testFile,
        commands: ["10j", "dd", ":w"]
      });

      expect(result.isError).toBeFalsy(); // Should stay at last line
      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toBe(""); // Should delete the only line
    });
  });
});
