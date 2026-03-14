// test/vim/vim.delete.test.ts
import { VimToolManager } from "../../src/utils/vim";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);
const unlink = promisify(fs.unlink);

describe("VimToolManager - :delete command", () => {
  let manager: VimToolManager;
  let testDir: string;
  let testFile: string;

  beforeEach(async () => {
    testDir = path.join(__dirname, "temp_delete_test");
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

  it("should delete all lines with :1,$delete", async () => {
    const content = "line 1\nline 2\nline 3\nline 4\nline 5\n";
    await writeFile(testFile, content, "utf-8");

    const result = await manager.callTool("vim", {
      commands: [":e test.txt", ":1,$delete", ":w"],
    });

    expect(result.isError).toBeFalsy();

    const updated = await readFile(testFile, "utf-8");
    expect(updated.trim()).toBe("");
  });

  it("should delete all lines with :%delete", async () => {
    const content = "line 1\nline 2\nline 3\n";
    await writeFile(testFile, content, "utf-8");

    const result = await manager.callTool("vim", {
      commands: [":e test.txt", ":%delete", ":w"],
    });

    expect(result.isError).toBeFalsy();

    const updated = await readFile(testFile, "utf-8");
    expect(updated.trim()).toBe("");
  });

  it("should delete the first line with :1d", async () => {
    const content = "line 1\nline 2\nline 3\nline 4\nline 5\n";
    await writeFile(testFile, content, "utf-8");

    const result = await manager.callTool("vim", {
      commands: [":e test.txt", ":1d", ":w"],
    });

    expect(result.isError).toBeFalsy();

    const updated = await readFile(testFile, "utf-8");
    const lines = updated.trimEnd().split("\n");
    expect(lines).toEqual(["line 2", "line 3", "line 4", "line 5"]);
  });

  it("should delete a range of lines with :2,4delete", async () => {
    const content = "line 1\nline 2\nline 3\nline 4\nline 5\n";
    await writeFile(testFile, content, "utf-8");

    const result = await manager.callTool("vim", {
      commands: [":e test.txt", ":2,4delete", ":w"],
    });

    expect(result.isError).toBeFalsy();

    const updated = await readFile(testFile, "utf-8");
    const lines = updated.trimEnd().split("\n");
    expect(lines).toEqual(["line 1", "line 5"]);
  });
});
