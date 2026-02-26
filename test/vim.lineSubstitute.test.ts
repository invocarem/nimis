// test/vim.lineSpecificSubstitute.test.ts
import { VimToolManager } from "../src/utils/vim";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);
const mkdir = promisify(fs.mkdir);

describe("VimToolManager - Line Specific Substitute", () => {
  let manager: VimToolManager;
  let testDir: string;
  let testFile: string;

  beforeEach(async () => {
    testDir = path.join(__dirname, "temp_line_sub_test");
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
    } catch (e) {
      // Ignore
    }
  });

  it("should replace single space with 4 spaces on line 12", async () => {
    // Create a file with 15 lines, where line 12 has a leading space
    const lines = [];
    for (let i = 1; i <= 15; i++) {
      if (i === 12) {
        lines.push(" hello");  // Line 12 with leading space
      } else {
        lines.push(`line ${i}`);
      }
    }
    const content = lines.join('\n');
    await writeFile(testFile, content, "utf-8");

    // Run the substitute command on line 12
    const result = await manager.callTool("vim", {
      file_path: testFile,
      commands: [
        ":e test.txt",
        ":12s/^ /    /",  // Replace leading space with 4 spaces
        ":w"
      ]
    });

    expect(result.isError).toBeFalsy();
    
    // Read the file and verify the change
    const updatedContent = await readFile(testFile, "utf-8");
    const updatedLines = updatedContent.split('\n');
    
    // Check line 12 (index 11) has 4 spaces instead of 1
    expect(updatedLines[11]).toBe("    hello");
    
    // Verify other lines unchanged
    expect(updatedLines[0]).toBe("line 1");
    expect(updatedLines[10]).toBe("line 11");
    expect(updatedLines[12]).toBe("line 13");
  });

  it("should only affect line 12 when using :12s/^ /    /", async () => {
    // Create a file with multiple lines that have leading spaces
    const lines = [];
    for (let i = 1; i <= 15; i++) {
      if (i === 5 || i === 12 || i === 14) {
        lines.push(" hello");  // Lines 5, 12, 14 have leading space
      } else {
        lines.push(`line ${i}`);
      }
    }
    const content = lines.join('\n');
    await writeFile(testFile, content, "utf-8");

    const result = await manager.callTool("vim", {
      file_path: testFile,
      commands: [
        ":e test.txt",
        ":12s/^ /    /",  // Should only affect line 12
        ":w"
      ]
    });

    expect(result.isError).toBeFalsy();
    
    const updatedContent = await readFile(testFile, "utf-8");
    const updatedLines = updatedContent.split('\n');
    
    // Only line 12 should be changed
    expect(updatedLines[4]).toBe(" hello");   // Line 5 unchanged (still 1 space)
    expect(updatedLines[11]).toBe("    hello"); // Line 12 changed to 4 spaces
    expect(updatedLines[13]).toBe(" hello");   // Line 14 unchanged
  });

  it("should handle line that doesn't match pattern gracefully", async () => {
    // Line 12 has no leading space
    const lines = [];
    for (let i = 1; i <= 15; i++) {
      lines.push(`line ${i}`);  // No leading spaces anywhere
    }
    const content = lines.join('\n');
    await writeFile(testFile, content, "utf-8");

    const result = await manager.callTool("vim", {
      file_path: testFile,
      commands: [
        ":e test.txt",
        ":12s/^ /    /",  // Pattern won't match
        ":w"
      ]
    });

    expect(result.isError).toBeFalsy();
    
    // File should remain unchanged
    const updatedContent = await readFile(testFile, "utf-8");
    expect(updatedContent).toBe(content);
  });
});
