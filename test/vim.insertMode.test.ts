// test/vim.insertMode.test.ts
import { VimToolManager } from "../src/utils/vim";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);
const unlink = promisify(fs.unlink);

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

  it("should insert text at beginning of line with i command", async () => {
    const content = "line 1\nline 2\nline 3\n";
    await writeFile(testFile, content, "utf-8");

    const result = await manager.callTool("vim_edit", {
      file_path: testFile,
      commands: [
        "2G",        // Go to line 2
        "i",         // Enter insert mode
        "START",     // Text to insert
        "\x1b",      // Escape to return to normal mode
        ":w"         // Save
      ]
    });

    expect(result.isError).toBeFalsy();
    const updatedContent = await readFile(testFile, "utf-8");
    expect(updatedContent).toBe("line 1\nSTARTline 2\nline 3\n");
  });

  it("should append text at end of line with a command", async () => {
    const content = "line 1\nline 2\nline 3\n";
    await writeFile(testFile, content, "utf-8");

    const result = await manager.callTool("vim_edit", {
      file_path: testFile,
      commands: [
        "2G",        // Go to line 2
        "$",         // Move to end of line
        "a",         // Enter insert mode after cursor
        "END",       // Text to append
        "\x1b",      // Escape to return to normal mode
        ":w"         // Save
      ]
    });

    expect(result.isError).toBeFalsy();
    const updatedContent = await readFile(testFile, "utf-8");
    expect(updatedContent).toBe("line 1\nline 2END\nline 3\n");
  });

  it("should handle multiple insert operations in sequence", async () => {
    const content = "line 1\nline 2\nline 3\n";
    await writeFile(testFile, content, "utf-8");

    const result = await manager.callTool("vim_edit", {
      file_path: testFile,
      commands: [
        "gg",        // Go to line 1
        "i",         // Enter insert mode
        "START",     // Insert at beginning
        "\x1b",      // Escape
        "G",         // Go to last line
        "A",         // Enter insert mode at end of line
        "END",       // Append at end
        "\x1b",      // Escape
        ":w"         // Save
      ]
    });

    expect(result.isError).toBeFalsy();
    const updatedContent = await readFile(testFile, "utf-8");
    expect(updatedContent).toBe("STARTline 1\nline 2\nline 3END\n");
  });

  it("should handle insert mode with multiple lines of text", async () => {
    const content = "line 1\nline 2\nline 3\n";
    await writeFile(testFile, content, "utf-8");

    const result = await manager.callTool("vim_edit", {
      file_path: testFile,
      commands: [
        "2G",        // Go to line 2
        "i",         // Enter insert mode
        "FIRST",     // First line to insert
        "\n",        // New line
        "SECOND",    // Second line
        "\n",        // New line
        "THIRD",     // Third line
        "\x1b",      // Escape
        ":w"         // Save
      ]
    });

    expect(result.isError).toBeFalsy();
    const updatedContent = await readFile(testFile, "utf-8");
    expect(updatedContent).toBe("line 1\nFIRST\nSECOND\nTHIRDline 2\nline 3\n");
  });

  it("should handle A command (append at end of line)", async () => {
    const content = "line 1\nline 2\nline 3\n";
    await writeFile(testFile, content, "utf-8");

    const result = await manager.callTool("vim_edit", {
      file_path: testFile,
      commands: [
        "2G",        // Go to line 2
        "A",         // Enter insert mode at end of line
        " ADDED",    // Text to append
        "\x1b",      // Escape
        ":w"         // Save
      ]
    });

    expect(result.isError).toBeFalsy();
    const updatedContent = await readFile(testFile, "utf-8");
    expect(updatedContent).toBe("line 1\nline 2 ADDED\nline 3\n");
  });

  it("should handle I command (insert at beginning of line)", async () => {
    const content = "line 1\nline 2\nline 3\n";
    await writeFile(testFile, content, "utf-8");

    const result = await manager.callTool("vim_edit", {
      file_path: testFile,
      commands: [
        "2G",        // Go to line 2
        "I",         // Enter insert mode at beginning of line
        "START ",    // Text to insert
        "\x1b",      // Escape
        ":w"         // Save
      ]
    });

    expect(result.isError).toBeFalsy();
    const updatedContent = await readFile(testFile, "utf-8");
    expect(updatedContent).toBe("line 1\nSTART line 2\nline 3\n");
  });

  it("should handle o command (open line below)", async () => {
    const content = "line 1\nline 2\nline 3\n";
    await writeFile(testFile, content, "utf-8");

    const result = await manager.callTool("vim_edit", {
      file_path: testFile,
      commands: [
        "2G",        // Go to line 2
        "o",         // Open line below and enter insert mode
        "NEW LINE",  // Text in new line
        "\x1b",      // Escape
        ":w"         // Save
      ]
    });

    expect(result.isError).toBeFalsy();
    const updatedContent = await readFile(testFile, "utf-8");
    expect(updatedContent).toBe("line 1\nline 2\nNEW LINE\nline 3\n");
  });

  it("should handle O command (open line above)", async () => {
    const content = "line 1\nline 2\nline 3\n";
    await writeFile(testFile, content, "utf-8");

    const result = await manager.callTool("vim_edit", {
      file_path: testFile,
      commands: [
        "2G",        // Go to line 2
        "O",         // Open line above and enter insert mode
        "NEW LINE",  // Text in new line
        "\x1b",      // Escape
        ":w"         // Save
      ]
    });

    expect(result.isError).toBeFalsy();
    const updatedContent = await readFile(testFile, "utf-8");
    expect(updatedContent).toBe("line 1\nNEW LINE\nline 2\nline 3\n");
  });

  it("should handle backspace in insert mode", async () => {
    const content = "line 1\nline 2\nline 3\n";
    await writeFile(testFile, content, "utf-8");

    const result = await manager.callTool("vim_edit", {
      file_path: testFile,
      commands: [
        "2G",        // Go to line 2
        "i",         // Enter insert mode
        "EXTRA",     // Insert text
        "\b\b",      // Backspace twice
        "\x1b",      // Escape
        ":w"         // Save
      ]
    });

    expect(result.isError).toBeFalsy();
    const updatedContent = await readFile(testFile, "utf-8");
    expect(updatedContent).toBe("line 1\nEXTline 2\nline 3\n");
  });

  it("should handle complex insert mode operations", async () => {
    const content = "function test() {\n    return null;\n}\n";
    await writeFile(testFile, content, "utf-8");

    const result = await manager.callTool("vim_edit", {
      file_path: testFile,
      commands: [
        "2G",        // Go to line 2 (return statement)
        "O",         // Open line above and enter insert mode
        "    console.log('debug');",  // Insert debug line
        "\x1b",      // Escape
        ":w"         // Save
      ]
    });

    expect(result.isError).toBeFalsy();
    const updatedContent = await readFile(testFile, "utf-8");
    expect(updatedContent).toBe(
      "function test() {\n    console.log('debug');\n    return null;\n}\n"
    );
  });
});