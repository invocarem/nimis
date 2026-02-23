// test/vim.patternSearch.test.ts
import { VimToolManager } from "../src/utils/vim";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);
const mkdir = promisify(fs.mkdir);

describe("VimToolManager - Pattern Search Commands", () => {
  let manager: VimToolManager;
  let testDir: string;
  let testFile: string;

  beforeEach(async () => {
    testDir = path.join(__dirname, "temp_pattern_test");
    testFile = path.join(testDir, "calc.py");
    
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

  it("should find line with pattern and execute command", async () => {
    // Create a file with the target line
    const content = [
      "def add(a, b):",
      "    return a + b",
      "",
      "def calculate(op, a, b):",
      "    if op == 'add':",
      "        result = operations[op](a, b)",
      "        return result",
      "    return None"
    ].join('\n');
    await writeFile(testFile, content, "utf-8");

    // Search for the pattern and delete the line (using :g/pattern/d)
    const result = await manager.callTool("vim_edit", {
      file_path: testFile,
      commands: [
        ":g/operations\\[op\\]/d",  // Delete line containing operations[op]
        ":w"
      ]
    });

    expect(result.isError).toBeFalsy();
    
    const updatedContent = await readFile(testFile, "utf-8");
    expect(updatedContent).not.toContain("result = operations[op](a, b)");
  });

  it("should find line with pattern and substitute on that line", async () => {
    const content = [
      "def add(a, b):",
      "    return a + b",
      "",
      "def calculate(op, a, b):",
      "    if op == 'add':",
      "        result = operations[op](a, b)",
      "        return result",
      "    return None"
    ].join('\n');
    await writeFile(testFile, content, "utf-8");

    // Search for the pattern and substitute on that line (using :g/pattern/s/old/new/)
    const result = await manager.callTool("vim_edit", {
      file_path: testFile,
      commands: [
        ":g/operations\\[op\\]/s/result = /output = /",
        ":w"
      ]
    });

    expect(result.isError).toBeFalsy();
    
    const updatedContent = await readFile(testFile, "utf-8");
    expect(updatedContent).toContain("output = operations[op](a, b)");
    expect(updatedContent).not.toContain("result = operations[op](a, b)");
  });

  it("should support :/pattern/ to jump to line then o to open new line below", async () => {
    // Reproduces: :/^    if b == 0/ then o to insert - currently fails with "Unsupported Ex command: ^"
    const content = [
      "def div(a, b):",
      "    if b == 0:",
      "        return None",
      "    return a / b"
    ].join('\n');
    await writeFile(testFile, content, "utf-8");

    const result = await manager.callTool("vim_edit", {
      file_path: testFile,
      commands: [
        ":/^    if b == 0/",  // Jump to line matching pattern
        "o",                  // Open new line below
        "        raise ValueError(\"Cannot divide by zero\")",
        "\x1b",
        ":w"
      ]
    });

    expect(result.isError).toBeFalsy();

    const updatedContent = await readFile(testFile, "utf-8");
    expect(updatedContent).toContain("raise ValueError");
    expect(updatedContent).toContain("Cannot divide by zero");
  });

  it("should handle pattern not found gracefully", async () => {
    const content = [
      "def add(a, b):",
      "    return a + b"
    ].join('\n');
    await writeFile(testFile, content, "utf-8");

    const result = await manager.callTool("vim_edit", {
      file_path: testFile,
      commands: [
        ":g/^nonexistent pattern/d",  // Pattern won't match - no-op
        ":w"
      ]
    });

    // Should not error, just do nothing
    expect(result.isError).toBeFalsy();
    
    const updatedContent = await readFile(testFile, "utf-8");
    expect(updatedContent).toBe(content);  // Unchanged
  });
});
