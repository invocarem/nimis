// test/vim.globalCommands.test.ts
import { VimToolManager } from "../src/utils/vim";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);
const mkdir = promisify(fs.mkdir);

describe("VimToolManager - Global Commands", () => {
  let manager: VimToolManager;
  let testDir: string;
  let testFile: string;

  beforeEach(async () => {
    testDir = path.join(__dirname, "temp_global_test");
    testFile = path.join(testDir, "test.txt");
    
    if (!fs.existsSync(testDir)) {
      await mkdir(testDir, { recursive: true });
    }

    manager = new VimToolManager(testDir);
    
    const content = "apple\nbanana\napple pie\ncherry\nbanana split\n";
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

  it("should delete lines matching pattern with :g", async () => {
    const result = await manager.callTool("vim_edit", {
      file_path: testFile,
      commands: [
        ":g/apple/d",
        ":w"
      ]
    });

    expect(result.isError).toBeFalsy();

    const content = await readFile(testFile, "utf-8");
    expect(content).toBe("banana\ncherry\nbanana split\n");
  });

  it("should delete lines NOT matching pattern with :v", async () => {
    const result = await manager.callTool("vim_edit", {
      file_path: testFile,
      commands: [
        ":v/apple/d",
        ":w"
      ]
    });

    expect(result.isError).toBeFalsy();

    const content = await readFile(testFile, "utf-8");
    expect(content).toBe("apple\napple pie\n");
  });

  it("should handle global with substitute", async () => {
    const result = await manager.callTool("vim_edit", {
      file_path: testFile,
      commands: [
        ":g/apple/s/apple/orange/g",
        ":w"
      ]
    });

    expect(result.isError).toBeFalsy();

    const content = await readFile(testFile, "utf-8");
    expect(content).toContain("orange");
    expect(content).toContain("orange pie");
  });
});
