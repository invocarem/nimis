// test/vim/vim.basicOperations.test.ts
import { VimToolManager } from "../../src/utils/vim";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);
const mkdir = promisify(fs.mkdir);

describe("VimToolManager - Basic Operations", () => {
  let manager: VimToolManager;
  let testDir: string;
  let testFile: string;

  beforeEach(async () => {
    testDir = path.join(__dirname, "temp_basic_test");
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
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  it("should create a new file with :e and write with :w", async () => {
    const result = await manager.callTool("vim", {
      commands: [
        ":e test.txt",
        "i",
        "# This is a test file",
        "def test_function():",
        "    return 'hello world'",
        "\x1b",         // Exit insert mode
        ":w"
      ]
    });

    expect(result.isError).toBeFalsy();
    //expect(result.content[0].text).toContain("Executed 5 command(s)");
    
    // Verify file was created
    const content = await readFile(testFile, "utf-8");
    expect(content).toContain("# This is a test file");
    expect(content).toContain("def test_function():");
    expect(content).toContain("    return 'hello world'");
  });

  it("should handle file not found gracefully", async () => {
    const result = await manager.callTool("vim", {
      commands: [
        ":e nonexistent.py", 
        "i# New file", 
        "\x1b",
        ":w"]
    });

    expect(result.isError).toBeFalsy();
    
    // Verify file was created
    const content = await readFile(path.join(testDir, "nonexistent.py"), "utf-8");
    expect(content).toContain("# New file");
  });
});
