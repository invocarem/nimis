// test/vim.deleteYank.test.ts
import { VimToolManager } from "../src/utils/vim";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);
const mkdir = promisify(fs.mkdir);

describe("VimToolManager - Delete and Yank Operations", () => {
  let manager: VimToolManager;
  let testDir: string;
  let testFile: string;

  beforeEach(async () => {
    testDir = path.join(__dirname, "temp_del_yank_test");
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

  it("should yank and put lines with register", async () => {
    const result = await manager.callTool("vim_edit", {
      file_path: testFile,
      commands: [
        ":2,3y a",
        "Go",
        "iPasted:",
        "'ap",
        ":w"
      ]
    });

    expect(result.isError).toBeFalsy();

    const content = await readFile(testFile, "utf-8");
    expect(content).toContain("Pasted:\nline 2\nline 3");
  });

  it("should delete lines to register and put elsewhere", async () => {
    const result = await manager.callTool("vim_edit", {
      file_path: testFile,
      commands: [
        ":2d a",
        "G",
        "'ap",
        ":w"
      ]
    });

    expect(result.isError).toBeFalsy();

    const content = await readFile(testFile, "utf-8");
    expect(content).toBe("line 1\nline 3\nline 4\nline 5\nline 2\n");
  });

  it("should verify register contents after yank", async () => {
    await manager.callTool("vim_edit", {
      file_path: testFile,
      commands: [":2,3y a"]
    });

    const registers = await manager.callTool("vim_show_registers", {});
    expect(registers.content[0].text).toContain('"a');
    expect(registers.content[0].text).toContain('line 2');
    expect(registers.content[0].text).toContain('line 3');
  });
});
