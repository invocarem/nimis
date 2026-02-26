// test/vim/vim.grep.test.ts
import { VimToolManager } from "../../src/utils/vim";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);
const unlink = promisify(fs.unlink);

describe("VimToolManager - :grep command", () => {
  let manager: VimToolManager;
  let testDir: string;
  let file1: string;
  let file2: string;
  let subDir: string;

  beforeEach(async () => {
    testDir = path.join(__dirname, "temp_grep_test");
    file1 = path.join(testDir, "a.txt");
    file2 = path.join(testDir, "b.ts");
    subDir = path.join(testDir, "sub");

    if (!fs.existsSync(testDir)) await mkdir(testDir, { recursive: true });
    if (!fs.existsSync(subDir)) await mkdir(subDir, { recursive: true });
    manager = new VimToolManager(testDir);
  });

  afterEach(async () => {
    try {
      if (fs.existsSync(file1)) await unlink(file1);
      if (fs.existsSync(file2)) await unlink(file2);
      const nested = path.join(subDir, "nested.txt");
      if (fs.existsSync(nested)) await unlink(nested);
      if (fs.existsSync(subDir)) await fs.promises.rmdir(subDir);
      if (fs.existsSync(testDir)) await fs.promises.rmdir(testDir);
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("Basic :grep", () => {
    it("should grep for pattern and return matching lines", async () => {
      await writeFile(file1, "hello world\nfoo bar\nhello again\n", "utf-8");
      await writeFile(file2, "no match\n", "utf-8");

      const result = await manager.callTool("vim", {
        commands: [":grep hello"],
      });

      expect(result.isError).toBeFalsy();
      const output = result.content[0].text ?? "";
      expect(output).toContain("a.txt:1:");
      expect(output).toContain("hello world");
      expect(output).toContain("a.txt:3:");
      expect(output).toContain("hello again");
      expect(output).not.toContain("b.ts");
    });

    it("should support file glob filter", async () => {
      await writeFile(file1, "needle\n", "utf-8");
      await writeFile(file2, "needle\n", "utf-8");

      const result = await manager.callTool("vim", {
        commands: [":grep needle *.ts"],
      });

      expect(result.isError).toBeFalsy();
      const output = result.content[0].text ?? "";
      expect(output).toContain("b.ts");
      expect(output).not.toContain("a.txt");
    });

    it("should return message when no matches", async () => {
      await writeFile(file1, "only this\n", "utf-8");

      const result = await manager.callTool("vim", {
        commands: [":grep nonexistent"],
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("No matches found");
    });

    it("should error when pattern is invalid regex", async () => {
      const result = await manager.callTool("vim", {
        commands: [":grep ["],
      });

      expect(result.isError).toBeTruthy();
      expect(result.content[0].text).toContain("Invalid regex");
    });

    it("should error when :grep has no pattern", async () => {
      const result = await manager.callTool("vim", {
        commands: [":grep"],
      });

      expect(result.isError).toBeTruthy();
      expect(result.content[0].text).toContain("requires a pattern");
    });
  });

  describe(":grep with buffer (ExCommandHandler path)", () => {
    it("should grep when a file is open", async () => {
      await writeFile(file1, "alpha beta\ngamma alpha\n", "utf-8");
      await writeFile(file2, "alpha\n", "utf-8");

      const result = await manager.callTool("vim", {
        file_path: file1,
        commands: [":e a.txt", ":grep alpha"],
      });

      expect(result.isError).toBeFalsy();
      const output = result.content[0].text ?? "";
      expect(output).toContain("alpha");
    });
  });
});
