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
    const result = await manager.callTool("vim", {
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
    const result = await manager.callTool("vim", {
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

    const result = await manager.callTool("vim", {
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

  it("should delete line using :/pattern/d with escaped parentheses", async () => {
    const content = [
      'def greet(name):',
      '    return f"Hello, {name}!"',
      '',
      'print(greet("Nimis"))',
      'print("done")',
    ].join('\n');
    await writeFile(testFile, content, "utf-8");

    const result = await manager.callTool("vim", {
      file_path: testFile,
      commands: [
        ':/print\\(greet\\("Nimis"\\)/d',
        ":w"
      ]
    });

    expect(result.isError).toBeFalsy();

    const updatedContent = await readFile(testFile, "utf-8");
    expect(updatedContent).not.toContain('print(greet("Nimis"))');
    expect(updatedContent).toContain('print("done")');
  });

  it("should support \\{n\\} vim quantifier in substitute", async () => {
    const content = [
      "line1",
      "line2",
      " one_space_indent",
      "  two_space_indent",
      "line5"
    ].join('\n');
    await writeFile(testFile, content, "utf-8");

    // :3s/^ \{1\}/  /  — replace exactly 1 leading space with 2 spaces on line 3
    const result = await manager.callTool("vim", {
      file_path: testFile,
      commands: [
        ":3s/^ \\{1\\}/  /",
        ":w"
      ]
    });

    expect(result.isError).toBeFalsy();

    const updatedContent = await readFile(testFile, "utf-8");
    expect(updatedContent).toContain("  one_space_indent");
    // Line 4 (two_space_indent) should be unchanged
    expect(updatedContent).toContain("  two_space_indent");
  });

  it("should support \\{n,m\\} vim quantifier in substitute", async () => {
    const content = [
      "a",
      "aa",
      "aaa",
      "aaaa"
    ].join('\n');
    await writeFile(testFile, content, "utf-8");

    // :%s/a\{2,3\}/X/  — replace 2-3 consecutive 'a' with X
    const result = await manager.callTool("vim", {
      file_path: testFile,
      commands: [
        ":%s/a\\{2,3\\}/X/",
        ":w"
      ]
    });

    expect(result.isError).toBeFalsy();

    const updatedContent = await readFile(testFile, "utf-8");
    const lines = updatedContent.split('\n');
    expect(lines[0]).toBe("a");     // 1 'a' — no match
    expect(lines[1]).toBe("X");     // 2 'a' → X
    expect(lines[2]).toBe("X");     // 3 'a' → X
    expect(lines[3]).toBe("Xa");    // 4 'a' → greedy matches 3, leaves 1
  });

  it("should handle pattern not found gracefully", async () => {
    const content = [
      "def add(a, b):",
      "    return a + b"
    ].join('\n');
    await writeFile(testFile, content, "utf-8");

    const result = await manager.callTool("vim", {
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
