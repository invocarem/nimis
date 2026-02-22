// test/vim.simpleLines.test.ts
import { VimToolManager } from "../src/utils/vim";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);
const unlink = promisify(fs.unlink);

describe("VimToolManager - Simple 3-line file creation", () => {
  let manager: VimToolManager;
  let testDir: string;
  let testFile: string;

  beforeEach(async () => {
    testDir = path.join(__dirname, "temp_simple_test");
    testFile = path.join(testDir, "fruits.txt");
    
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

  it("should create a file with three lines: apple, banana, orange (separate i and lines)", async () => {
    const result = await manager.callTool("vim_edit", {
      file_path: testFile,
      commands: [
        "i",           // Enter insert mode
        "apple",       // First line
        "banana",      // Second line
        "orange",      // Third line
        "\x1b",        // Exit insert mode
        ":w"           // Save
      ]
    });

    // Verify the operation succeeded
    expect(result.isError).toBeFalsy();
    
    // Read the file and verify content
    const content = await readFile(testFile, "utf-8");
    const lines = content.split('\n');
    
    // Check each line
    expect(lines[0]).toBe("apple");
    expect(lines[1]).toBe("banana");
    expect(lines[2]).toBe("orange");
    
    // Should have exactly 3 lines (plus empty string after final newline)
    expect(lines.length).toBe(4); // ["apple", "banana", "orange", ""]
    expect(lines[3]).toBe(""); // Final newline
    
    // Verify the exact content string
    expect(content).toBe("apple\nbanana\norange\n");
  });

  it("should create a file with three lines: apple, banana, orange (i combined with first line)", async () => {
    const result = await manager.callTool("vim_edit", {
      file_path: testFile,
      commands: [
        "iapple",      // Enter insert mode AND type first line in one command
        "banana",      // Second line
        "orange",      // Third line
        "\x1b",        // Exit insert mode
        ":w"           // Save
      ]
    });

    // Verify the operation succeeded
    expect(result.isError).toBeFalsy();
    
    // Read the file and verify content
    const content = await readFile(testFile, "utf-8");
    const lines = content.split('\n');
    
    // Check each line
    expect(lines[0]).toBe("apple");
    expect(lines[1]).toBe("banana");
    expect(lines[2]).toBe("orange");
    
    // Should have exactly 3 lines (plus empty string after final newline)
    expect(lines.length).toBe(4); // ["apple", "banana", "orange", ""]
    expect(lines[3]).toBe(""); // Final newline
    
    // Verify the exact content string
    expect(content).toBe("apple\nbanana\norange\n");
  });
});