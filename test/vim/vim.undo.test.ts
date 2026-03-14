// test/vim/vim.undo.test.ts
import { VimToolManager } from "../../src/utils/vim";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);
const unlink = promisify(fs.unlink);

describe("VimToolManager - Undo (u) command", () => {
  let manager: VimToolManager;
  let testDir: string;
  let testFile: string;

  beforeEach(async () => {
    testDir = path.join(__dirname, "temp_undo_test");
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
        await fs.promises.rmdir(testDir);
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  it("should undo dd (delete line)", async () => {
    const content = "line 1\nline 2\nline 3\n";
    await writeFile(testFile, content, "utf-8");

    const result = await manager.callTool("vim", {
      commands: [":e test.txt", "dd", "u", ":w"],
    });

    expect(result.isError).toBeFalsy();

    const updated = await readFile(testFile, "utf-8");
    const lines = updated.trimEnd().split("\n");
    expect(lines).toEqual(["line 1", "line 2", "line 3"]);
  });

  it("should undo multiple dd with multiple u", async () => {
    const content = "line 1\nline 2\nline 3\nline 4\n";
    await writeFile(testFile, content, "utf-8");

    const result = await manager.callTool("vim", {
      commands: [":e test.txt", "dd", "dd", "u", "u", ":w"],
    });

    expect(result.isError).toBeFalsy();

    const updated = await readFile(testFile, "utf-8");
    const lines = updated.trimEnd().split("\n");
    expect(lines).toEqual(["line 1", "line 2", "line 3", "line 4"]);
  });

  it("should undo dG (delete to end of file)", async () => {
    const content = "line 1\nline 2\nline 3\nline 4\n";
    await writeFile(testFile, content, "utf-8");

    const result = await manager.callTool("vim", {
      commands: [":e test.txt", "dG", "u", ":w"],
    });

    expect(result.isError).toBeFalsy();

    const updated = await readFile(testFile, "utf-8");
    const lines = updated.trimEnd().split("\n");
    expect(lines).toEqual(["line 1", "line 2", "line 3", "line 4"]);
  });

  it("should undo x (delete character)", async () => {
    const content = "hello\n";
    await writeFile(testFile, content, "utf-8");

    const result = await manager.callTool("vim", {
      commands: [":e test.txt", "x", "u", ":w"],
    });

    expect(result.isError).toBeFalsy();

    const updated = await readFile(testFile, "utf-8");
    expect(updated.trimEnd()).toBe("hello");
  });

  it("should undo p (put/paste after)", async () => {
    const content = "line 1\nline 2\nline 3\n";
    await writeFile(testFile, content, "utf-8");

    const result = await manager.callTool("vim", {
      commands: [":e test.txt", "yy", "p", "u", ":w"],
    });

    expect(result.isError).toBeFalsy();

    const updated = await readFile(testFile, "utf-8");
    const lines = updated.trimEnd().split("\n");
    expect(lines).toEqual(["line 1", "line 2", "line 3"]);
  });

  it("should undo insert mode text entry", async () => {
    const content = "hello world\n";
    await writeFile(testFile, content, "utf-8");

    const result = await manager.callTool("vim", {
      commands: [":e test.txt", "i", "INSERTED ", "\x1b", "u", ":w"],
    });

    expect(result.isError).toBeFalsy();

    const updated = await readFile(testFile, "utf-8");
    expect(updated.trimEnd()).toBe("hello world");
  });

  it("should undo o (open line below)", async () => {
    const content = "line 1\nline 2\n";
    await writeFile(testFile, content, "utf-8");

    const result = await manager.callTool("vim", {
      commands: [":e test.txt", "o", "new line", "\x1b", "u", ":w"],
    });

    expect(result.isError).toBeFalsy();

    const updated = await readFile(testFile, "utf-8");
    const lines = updated.trimEnd().split("\n");
    expect(lines).toEqual(["line 1", "line 2"]);
  });

  it("should undo O (open line above)", async () => {
    const content = "line 1\nline 2\n";
    await writeFile(testFile, content, "utf-8");

    const result = await manager.callTool("vim", {
      commands: [":e test.txt", "O", "new line", "\x1b", "u", ":w"],
    });

    expect(result.isError).toBeFalsy();

    const updated = await readFile(testFile, "utf-8");
    const lines = updated.trimEnd().split("\n");
    expect(lines).toEqual(["line 1", "line 2"]);
  });

  it("should report 'Already at oldest change' when nothing to undo", async () => {
    const content = "line 1\n";
    await writeFile(testFile, content, "utf-8");

    const result = await manager.callTool("vim", {
      commands: [":e test.txt", "u"],
    });

    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text || "";
    expect(text).toContain("Already at oldest change");
  });

  it("should undo 2dd (delete 2 lines with count)", async () => {
    const content = "line 1\nline 2\nline 3\nline 4\n";
    await writeFile(testFile, content, "utf-8");

    const result = await manager.callTool("vim", {
      commands: [":e test.txt", "2dd", "u", ":w"],
    });

    expect(result.isError).toBeFalsy();

    const updated = await readFile(testFile, "utf-8");
    const lines = updated.trimEnd().split("\n");
    expect(lines).toEqual(["line 1", "line 2", "line 3", "line 4"]);
  });

  it("should restore modified flag on undo", async () => {
    const content = "line 1\nline 2\n";
    await writeFile(testFile, content, "utf-8");

    // dd marks buffer modified, undo should restore unmodified state
    const result = await manager.callTool("vim", {
      commands: [":e test.txt", "dd", "u", ":w"],
    });

    expect(result.isError).toBeFalsy();

    const updated = await readFile(testFile, "utf-8");
    const lines = updated.trimEnd().split("\n");
    expect(lines).toEqual(["line 1", "line 2"]);
  });
});
