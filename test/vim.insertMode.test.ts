// test/vim.insert-mode.test.ts
import { VimToolManager } from "../src/utils/vim";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);

describe("VimToolManager - Insert Mode Operations", () => {
  let manager: VimToolManager;
  let testDir: string;
  let testFile: string;

  beforeEach(async () => {
    testDir = path.join(__dirname, "temp_insert_test");
    testFile = path.join(testDir, "test.txt");
    
    if (!fs.existsSync(testDir)) {
      await mkdir(testDir, { recursive: true });
    }

    manager = new VimToolManager(testDir);
  });

  it("should insert text at beginning of line with i command", async () => {
    const content = "line 1\nline 2\nline 3\n";
    await writeFile(testFile, content, "utf-8");

    await manager.callTool("vim_edit", {
      file_path: testFile,
      commands: [
        "2G",
        "iSTART",  // Insert at beginning of line 2
        ":w"
      ]
    });

    const updatedContent = await readFile(testFile, "utf-8");
    expect(updatedContent).toBe("line 1\nSTARTline 2\nline 3\n");
  });

  it("should append text at end of line with a command", async () => {
    const content = "line 1\nline 2\nline 3\n";
    await writeFile(testFile, content, "utf-8");

    await manager.callTool("vim_edit", {
      file_path: testFile,
      commands: [
        "2G",
        "aEND",  // Append to end of line 2
        ":w"
      ]
    });

    const updatedContent = await readFile(testFile, "utf-8");
    expect(updatedContent).toBe("line 1\nline 2END\nline 3\n");
  });

  it("should handle multiple insert operations in sequence", async () => {
    const content = "line 1\nline 2\nline 3\n";
    await writeFile(testFile, content, "utf-8");

    await manager.callTool("vim_edit", {
      file_path: testFile,
      commands: [
        "gg",
        "iSTART",  // Insert at beginning of line 1
        "G",
        "aEND",    // Append to end of line 3
        ":w"
      ]
    });

    const updatedContent = await readFile(testFile, "utf-8");
    expect(updatedContent).toBe("STARTline 1\nline 2\nline 3END\n");
  });
});
