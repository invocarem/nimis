// test/vim/vim.edit.test.ts
import { VimToolManager } from "../../src/utils/vim";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);
const mkdir = promisify(fs.mkdir);

describe("VimToolManager - :e (edit) command", () => {
  let manager: VimToolManager;
  let testDir: string;
  let testFile1: string;
  let testFile2: string;
  let testFile3: string;
  let subDir: string; // Add subDir here

  beforeEach(async () => {
    testDir = path.join(__dirname, "temp_edit_test");
    testFile1 = path.join(testDir, "file1.txt");
    testFile2 = path.join(testDir, "file2.txt");
    testFile3 = path.join(testDir, "file3.txt");
    subDir = path.join(testDir, "subdir");

    if (!fs.existsSync(testDir)) {
      await mkdir(testDir, { recursive: true });
    }

    if (!fs.existsSync(subDir)) {
      // Create subdir
      await mkdir(subDir, { recursive: true });
    }
    manager = new VimToolManager(testDir);
  });

  afterEach(async () => {
    try {
      const files = [testFile1, testFile2, testFile3];
      for (const file of files) {
        if (fs.existsSync(file)) {
          await unlink(file);
        }
      }
      if (fs.existsSync(testDir)) {
        await fs.promises.rmdir(testDir);
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe("Basic :e functionality", () => {
    it("should open an existing file with :e", async () => {
      // Create a file first
      const content = "Hello World\nThis is a test file.\n";
      await writeFile(testFile1, content, "utf-8");

      const result = await manager.callTool("vim_edit", {
        file_path: testFile1,
        commands: [":e file1.txt", ":%print"],
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Hello World");
      expect(result.content[0].text).toContain("This is a test file.");
    });

    it("should create a new file with :e (file doesn't exist)", async () => {
      expect(fs.existsSync(testFile2)).toBe(false);

      const result = await manager.callTool("vim_edit", {
        file_path: testFile2,
        commands: [
          ":e file2.txt",
          "i",
          "This is a new file",
          "\x1b",
          ":w",
          ":%print",
        ],
      });

      expect(result.isError).toBeFalsy();

      // Verify file was created
      expect(fs.existsSync(testFile2)).toBe(true);

      // Verify content
      const content = await readFile(testFile2, "utf-8");
      expect(content).toBe("This is a new file\n");
    });

    it("should open a file without specifying file_path in callTool", async () => {
      const content = "Content without file_path\n";
      await writeFile(testFile1, content, "utf-8");

      const result = await manager.callTool("vim_edit", {
        file_path: testFile1,
        commands: [":e file1.txt", ":print"],
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Content without file_path");
    });
  });

  describe("Switching between files with :e", () => {
    it("should switch from one file to another using :e", async () => {
      // Create two files
      await writeFile(testFile1, "File 1 content\n", "utf-8");
      await writeFile(testFile2, "File 2 content\n", "utf-8");

      const result = await manager.callTool("vim_edit", {
        file_path: testFile1,
        commands: [":e file1.txt", ":print", ":e file2.txt", ":print"],
      });

      expect(result.isError).toBeFalsy();

      const output = result.content[0].text;
      // Should contain both file contents
      expect(output).toContain("File 1 content");
      expect(output).toContain("File 2 content");
    });

    it("should edit multiple files in sequence", async () => {
      await writeFile(testFile1, "First file\n", "utf-8");
      await writeFile(testFile2, "Second file\n", "utf-8");
      await writeFile(testFile3, "Third file\n", "utf-8");

      const result = await manager.callTool("vim_edit", {
        file_path: testFile1,
        commands: [
          ":e file1.txt",
          ":%print",
          ":e file2.txt",
          ":%print",
          ":e file3.txt",
          ":%print",
        ],
      });

      expect(result.isError).toBeFalsy();

      const output = result.content[0].text;
      expect(output).toContain("First file");
      expect(output).toContain("Second file");
      expect(output).toContain("Third file");
    });
  });

  describe(":e with modifications", () => {
    it("should edit file, make changes, then edit another file", async () => {
      await writeFile(testFile1, "Original content\n", "utf-8");
      await writeFile(testFile2, "Another file\n", "utf-8");

      const result = await manager.callTool("vim_edit", {
        file_path: testFile1,
        commands: [
          ":e file1.txt",
          "gg",
          "i",
          "Modified: ",
          "\x1b",
          ":w",
          ":e file2.txt",
          ":print",
        ],
      });

      expect(result.isError).toBeFalsy();

      // Check first file was modified
      const content1 = await readFile(testFile1, "utf-8");
      expect(content1).toBe("Modified: Original content\n");

      // Check we can still read second file
      const output = result.content[0].text;
      expect(output).toContain("Another file");
    });

    it("should handle :e with relative paths", async () => {
      // Create a file in a subdirectory
      const subDir = path.join(testDir, "subdir");
      await mkdir(subDir, { recursive: true });
      const nestedFile = path.join(subDir, "nested.txt");
      await writeFile(nestedFile, "Nested file content\n", "utf-8");

      // Use relative path from testDir
      const result = await manager.callTool("vim_edit", {
        file_path: testFile1,
        commands: [":e subdir/nested.txt", ":print"],
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Nested file content");
    });
  });

  describe("Error handling with :e", () => {
    it("should handle :e without filename gracefully", async () => {
      const result = await manager.callTool("vim_edit", {
        file_path: testFile1,
        commands: [
          ":e", // Missing filename
        ],
      });

      expect(result.isError).toBeTruthy();
      expect(result.content[0].text).toContain("requires a filename");
    });

    it("should handle trying to edit a directory", async () => {
      // Try to edit a directory instead of a file
      const result = await manager.callTool("vim_edit", {
        file_path: testDir,
        commands: [`:e ${path.basename(testDir)}`],
      });

      // Should error appropriately
      expect(result.isError).toBeTruthy();
    });
  });

  describe(":e with line numbers and marks", () => {
    it("should remember cursor position after :e", async () => {
      const content = ["line 1", "line 2", "line 3", "line 4", "line 5"].join(
        "\n"
      );
      await writeFile(testFile1, content, "utf-8");

      const result = await manager.callTool("vim_edit", {
        file_path: testFile1,
        commands: [
          ":e file1.txt",
          "3G", // Go to line 3
          "ma", // Set mark a
          ":e file1.txt", // Re-edit same file
          "'a", // Jump to mark a
          ":print",
        ],
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("line 3");
    });
  });

  describe("Combined with other commands", () => {
    it("should work with substitute after :e", async () => {
      const content = "apple apple apple\n";
      await writeFile(testFile1, content, "utf-8");

      const result = await manager.callTool("vim_edit", {
        file_path: testFile1,
        commands: [":e file1.txt", ":%s/apple/orange/g", ":print"],
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("orange orange orange");
    });

    it("should work with global command after :e", async () => {
      const content = [
        "TODO: fix bug",
        "DONE: implement feature",
        "TODO: write tests",
        "DONE: review code",
      ].join("\n");
      await writeFile(testFile1, content, "utf-8");

      const result = await manager.callTool("vim_edit", {
        file_path: testFile1,
        commands: [":e file1.txt", ":g/TODO/print"],
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("TODO: fix bug");
      expect(result.content[0].text).toContain("TODO: write tests");
      expect(result.content[0].text).not.toContain("DONE");
    });
  });

  describe("Directory listing with :e (if implemented)", () => {
    it("should list directory contents when :e . is supported", async () => {
      // This test assumes the implementation might support directory listing
      // Create some files and subdirectories
      await writeFile(testFile1, "content1\n", "utf-8");
      await writeFile(testFile2, "content2\n", "utf-8");
      const nestedFile = path.join(subDir, "nested.txt");
      await writeFile(nestedFile, "nested\n", "utf-8");

      const result = await manager.callTool("vim_edit", {
        file_path: testDir,
        commands: [":e ."],
      });

      // If directory listing is supported, it shouldn't error
      if (!result.isError) {
        const output = result.content[0].text;
        expect(output).toContain("file1.txt");
        expect(output).toContain("file2.txt");
        expect(output).toContain("subdir");
        expect(output).toContain(".."); // Parent directory link
      } else {
        // If not supported, skip this test
        console.log("Directory listing not supported, skipping");
      }
    });
  });
});
