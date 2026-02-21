// test/vim.marks.test.ts
import { VimToolManager } from "../src/utils/vim";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);
const mkdir = promisify(fs.mkdir);

describe("VimToolManager - Marks", () => {
  let manager: VimToolManager;
  let testDir: string;
  let testFile: string;

  beforeEach(async () => {
    testDir = path.join(__dirname, "temp_marks_test");
    testFile = path.join(testDir, "test.txt");
    
    if (!fs.existsSync(testDir)) {
      await mkdir(testDir, { recursive: true });
    }

    manager = new VimToolManager(testDir);
    
    const content = "line 1\nline 2\nline 3\nline 4\nline 5\n";
    await writeFile(testFile, content, "utf-8");
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

  it("should set marks in normal mode", async () => {
    const result = await manager.callTool("vim_edit", {
      file_path: testFile,
      commands: [
        "2G",
        "ma",
        "4G",
        "mb"
      ]
    });

    expect(result.isError).toBeFalsy();

    const marks = await manager.callTool("vim_show_marks", {});
    expect(marks.content[0].text).toContain("'a");
    expect(marks.content[0].text).toContain("'b");
  });

  it("should jump to marks", async () => {
    await manager.callTool("vim_edit", {
      file_path: testFile,
      commands: [
        "2G",
        "ma",
        "4G",
        "mb"
      ]
    });

    const result = await manager.callTool("vim_edit", {
      file_path: testFile,
      commands: [
        "'a",
        "dd",
        "'b",
        "dd",
        ":w"
      ]
    });

    expect(result.isError).toBeFalsy();

    const content = await readFile(testFile, "utf-8");
    expect(content).toBe("line 1\nline 3\nline 5\n");
  });

  it("should yank between marks", async () => {
    await manager.callTool("vim_edit", {
      file_path: testFile,
      commands: [
        "2G",
        "ma",
        "4G",
        "mb"
      ]
    });

    const result = await manager.callTool("vim_edit", {
      file_path: testFile,
      commands: [
        "'a,'by c",
        "G",
        "\"cp",
        ":w"
      ]
    });

    expect(result.isError).toBeFalsy();

    const content = await readFile(testFile, "utf-8");
    expect(content).toContain("line 2\nline 3\nline 4");
  });
});
