// test/vim.complexEdit.test.ts
import { VimToolManager } from "../src/utils/vim";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);
const unlink = promisify(fs.unlink);

describe("VimToolManager - Complex edit with :e, gg, dG", () => {
  let manager: VimToolManager;
  let testDir: string;
  let testFile: string;

  beforeEach(async () => {
    testDir = path.join(__dirname, "temp_complex_test");
    testFile = path.join(testDir, "hello.py");
    
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

  it("should clear file with gg,dG and then write new content", async () => {
    // First create a file with some existing content
    const existingContent = `# Old file
print("This should be deleted")
x = 5
print(x)`;
    await writeFile(testFile, existingContent, "utf-8");

    // Now run the complex edit
    const result = await manager.callTool("vim", {
      file_path: testFile,
      commands: [
        ":e hello.py",
        "gg",           // Go to first line
        "dG",           // Delete from cursor to end of file
        "i",            // Enter insert mode
        "#!/usr/bin/env python3",
        "def greet(name):",
        '    """Print a friendly greeting to the given name."""',
        '    print(f"Hello, {name}!")',
        'if __name__ == "__main__":',
        '    greet("World")',
        "\x1b",         // Exit insert mode
        ":w"            // Save
      ]
    });

    // Verify the operation succeeded
    expect(result.isError).toBeFalsy();
    
    // Read the file and verify new content
    const content = await readFile(testFile, "utf-8");
    const lines = content.split('\n');
    
    // Check each line
    expect(lines[0]).toBe("#!/usr/bin/env python3");
    expect(lines[1]).toBe("def greet(name):");
    expect(lines[2]).toBe('    """Print a friendly greeting to the given name."""');
    expect(lines[3]).toBe('    print(f"Hello, {name}!")');
    expect(lines[4]).toBe('if __name__ == "__main__":');
    expect(lines[5]).toBe('    greet("World")');
    
    // Original file had no trailing newline, so we preserve that format
    expect(lines.length).toBe(6);
    
    // Verify the exact content string (no trailing newline - preserves original file format)
    expect(content).toBe(
      "#!/usr/bin/env python3\n" +
      "def greet(name):\n" +
      '    """Print a friendly greeting to the given name."""\n' +
      '    print(f"Hello, {name}!")\n' +
      'if __name__ == "__main__":\n' +
      '    greet("World")'
    );
  });

  it("should work even when file doesn't exist initially", async () => {
    // File doesn't exist yet
    const result = await manager.callTool("vim", {
      file_path: testFile,
      commands: [
        ":e hello.py",
        "gg",           // Go to first line (no-op on empty file)
        "dG",           // Delete from cursor to end (no-op on empty file)
        "i",            // Enter insert mode
        "#!/usr/bin/env python3",
        "def greet(name):",
        '    """Print a friendly greeting to the given name."""',
        '    print(f"Hello, {name}!")',
        'if __name__ == "__main__":',
        '    greet("World")',
        "\x1b",         // Exit insert mode
        ":w"            // Save
      ]
    });

    expect(result.isError).toBeFalsy();
    
    const content = await readFile(testFile, "utf-8");
    expect(content).toContain("#!/usr/bin/env python3");
    expect(content).toContain("def greet(name):");
    expect(content).toContain('print(f"Hello, {name}!")');
  });
});
