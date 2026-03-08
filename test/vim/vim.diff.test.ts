// test/vim/vim.diff.test.ts
import { VimToolManager } from "../../src/utils/vim";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);
const unlink = promisify(fs.unlink);

describe("VimToolManager - :diff command", () => {
  let manager: VimToolManager;
  let testDir: string;
  let file1: string;
  let file2: string;

  beforeEach(async () => {
    testDir = path.join(__dirname, "temp_diff_test");
    file1 = path.join(testDir, "old.ts");
    file2 = path.join(testDir, "new.ts");

    if (!fs.existsSync(testDir)) await mkdir(testDir, { recursive: true });
    manager = new VimToolManager(testDir);
  });

  afterEach(async () => {
    try {
      if (fs.existsSync(file1)) await unlink(file1);
      if (fs.existsSync(file2)) await unlink(file2);
      if (fs.existsSync(testDir)) await fs.promises.rmdir(testDir);
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should diff two files and return unified diff", async () => {
    await writeFile(file1, "line1\nline2\nline3\n", "utf-8");
    await writeFile(file2, "line1\nmodified\nline3\n", "utf-8");

    const result = await manager.callTool("vim", {
      commands: [":diff old.ts new.ts"],
    });

    expect(result.isError).toBeFalsy();
    const output = result.content[0].text ?? "";
    expect(output).toContain("---");
    expect(output).toContain("+++");
    expect(output).toContain("line2");
    expect(output).toContain("modified");
  });

  it("should return (no differences) when files are identical", async () => {
    const content = "alpha\nbeta\n";
    await writeFile(file1, content, "utf-8");
    await writeFile(file2, content, "utf-8");

    const result = await manager.callTool("vim", {
      commands: [":diff old.ts new.ts"],
    });

    expect(result.isError).toBeFalsy();
    const text = result.content[0].text ?? "";
    // createTwoFilesPatch returns "" for identical files; we display "(no differences)"
    expect(text).toContain("(no differences)");
  });

  it("should diff buffer vs file on disk (one arg)", async () => {
    await writeFile(file1, "original\ncontent\n", "utf-8");

    const result = await manager.callTool("vim", {
      file_path: "old.ts",
      commands: [
        ":e old.ts",
        "gg",
        "o",
        "inserted line",
        "\x1b",
        ":diff old.ts",
      ],
    });

    expect(result.isError).toBeFalsy();
    const output = result.content[0].text ?? "";
    expect(output).toContain("inserted line");
  });

  it("should error when :diff has no arguments", async () => {
    await writeFile(file1, "x\n", "utf-8");
    const result = await manager.callTool("vim", {
      commands: [":e old.ts", ":diff"],
    });

    expect(result.isError).toBeTruthy();
    expect(result.content[0].text).toContain("requires one or two file arguments");
  });
});
