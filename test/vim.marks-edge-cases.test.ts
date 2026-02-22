// test/vim.marks-edge-cases.test.ts
import { VimToolManager } from "../src/utils/vim";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);

describe("VimToolManager - Marks Edge Cases", () => {
  let manager: VimToolManager;
  let testDir: string;
  let testFile: string;

  beforeEach(async () => {
    testDir = path.join(__dirname, "temp_marks_edge_test");
    testFile = path.join(testDir, "test.txt");
    
    if (!fs.existsSync(testDir)) {
      await mkdir(testDir, { recursive: true });
    }

    manager = new VimToolManager(testDir);
  });

  it("should handle multiple marks in sequence", async () => {
    const content = "line1\nline2\nline3\nline4\nline5\n";
    await writeFile(testFile, content, "utf-8");

    const result = await manager.callTool("vim_edit", {
      file_path: testFile,
      commands: [
        "2G", "ma",  // Set mark a at line 2
        "4G", "mb",  // Set mark b at line 4
        "'a",        // Jump to mark a
        "dd",        // Delete line 2
        "'b",        // Jump to mark b (should now be at line 3 after deletion)
        "dd",        // Delete that line
        ":w"
      ]
    });

    expect(result.isError).toBeFalsy();

    const updatedContent = await readFile(testFile, "utf-8");
    expect(updatedContent).toBe("line1\nline3\nline5\n");
  });

  it("should preserve marks after buffer operations", async () => {
    const content = "line1\nline2\nline3\n";
    await writeFile(testFile, content, "utf-8");

    await manager.callTool("vim_edit", {
      file_path: testFile,
      commands: ["2G", "ma"]
    });

    // Do some operations that shouldn't affect the mark
    await manager.callTool("vim_edit", {
      file_path: testFile,
      commands: ["G", "iEND", ":w"]
    });

    const marksResult = await manager.callTool("vim_show_marks", {});
    expect(marksResult.content[0].text).toContain("'a");
    expect(marksResult.content[0].text).toContain("line2");
  });

  it("should handle mark ranges correctly", async () => {
    const content = "line1\nline2\nline3\nline4\nline5\n";
    await writeFile(testFile, content, "utf-8");

    const result = await manager.callTool("vim_edit", {
      file_path: testFile,
      commands: [
        "2G", "ma",
        "4G", "mb",
        ":'a,'bd", // Delete from mark a to mark b
        ":w"
      ]
    });

    expect(result.isError).toBeFalsy();

    const updatedContent = await readFile(testFile, "utf-8");
    expect(updatedContent).toBe("line1\nline5\n");
  });
});
