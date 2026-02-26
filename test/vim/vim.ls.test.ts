// test/vim/vim.ls.test.ts
import { VimToolManager } from "../../src/utils/vim";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);
const unlink = promisify(fs.unlink);

describe("VimToolManager - :!ls (shell) command", () => {
  let manager: VimToolManager;
  let testDir: string;
  let testFile1: string;
  let testFile2: string;
  let subDir: string;

  beforeEach(async () => {
    testDir = path.join(__dirname, "temp_ls_test");
    testFile1 = path.join(testDir, "file1.txt");
    testFile2 = path.join(testDir, "file2.txt");
    subDir = path.join(testDir, "subdir");

    if (!fs.existsSync(testDir)) {
      await mkdir(testDir, { recursive: true });
    }
    if (!fs.existsSync(subDir)) {
      await mkdir(subDir, { recursive: true });
    }

    manager = new VimToolManager(testDir);
  });

  afterEach(async () => {
    try {
      if (fs.existsSync(testFile1)) await unlink(testFile1);
      if (fs.existsSync(testFile2)) await unlink(testFile2);
      const nestedFile = path.join(subDir, "nested.txt");
      if (fs.existsSync(nestedFile)) await unlink(nestedFile);
      if (fs.existsSync(subDir)) await fs.promises.rmdir(subDir);
      if (fs.existsSync(testDir)) await fs.promises.rmdir(testDir);
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("Basic :!ls functionality", () => {
    it("should run :!ls and list directory contents", async () => {
      await writeFile(testFile1, "content1\n", "utf-8");
      await writeFile(testFile2, "content2\n", "utf-8");

      const result = await manager.callTool("vim", {
        commands: [":!ls"],
      });

      expect(result.isError).toBeFalsy();
      const output = result.content[0].text;
      expect(output).toContain("file1.txt");
      expect(output).toContain("file2.txt");
      expect(output).toContain("subdir");
    });

    it("should run :!ls with a subdirectory argument", async () => {
      const nestedFile = path.join(subDir, "nested.txt");
      await writeFile(nestedFile, "nested content\n", "utf-8");

      const result = await manager.callTool("vim", {
        commands: [":!ls subdir"],
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("nested.txt");
    });

    it("should run :!ls -la and include long format output", async () => {
      await writeFile(testFile1, "content\n", "utf-8");

      const result = await manager.callTool("vim", {
        commands: [":!ls -la"],
      });

      expect(result.isError).toBeFalsy();
      const output = result.content[0].text ?? "";
      expect(output).toContain("file1.txt");
      // ls -la typically shows permissions, links, owner, size, date
      expect(output.length).toBeGreaterThan(20);
    });
  });

  describe(":! with pwd and cd", () => {
    it("should run :pwd before :!ls to show working directory", async () => {
      await writeFile(testFile1, "x\n", "utf-8");

      const result = await manager.callTool("vim", {
        commands: [":pwd", ":!ls"],
      });

      expect(result.isError).toBeFalsy();
      const output = result.content[0].text;
      expect(output).toContain(testDir);
      expect(output).toContain("file1.txt");
    });

    it("should run :cd then :!ls in new directory", async () => {
      await writeFile(testFile1, "x\n", "utf-8");
      const nestedFile = path.join(subDir, "nested.txt");
      await writeFile(nestedFile, "nested\n", "utf-8");

      const result = await manager.callTool("vim", {
        commands: [":cd subdir", ":!ls"],
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("nested.txt");
    });
  });

  describe("Error handling", () => {
    it("should handle :! with no command (treats as unknown or empty)", async () => {
      const result = await manager.callTool("vim", {
        commands: [":!"],
      });

      // :! alone doesn't match the shell regex, so it falls through to "Unknown directory command"
      expect(result.content[0].text).toBeDefined();
      expect(
        result.content[0].text?.includes("Unknown") ||
          result.content[0].text?.includes("requires a shell command")
      ).toBeTruthy();
    });

    it("should return error when :! runs invalid command", async () => {
      const result = await manager.callTool("vim", {
        commands: [":!nonexistent_command_xyz_12345"],
      });

      expect(result.isError).toBeTruthy();
      expect(result.content[0].text).toContain("Shell command failed");
    });
  });
});
