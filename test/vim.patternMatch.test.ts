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
      const helloFile = path.join(testDir, "hello.py");
      if (fs.existsSync(helloFile)) {
        await unlink(helloFile);
      }
      const csFile = path.join(testDir, "NodeConfigBufferBuilder.cs");
      if (fs.existsSync(csFile)) {
        await unlink(csFile);
      }
    } catch (e) {
      // Ignore
    }
  });

  it("should handle :/pattern without closing slash - search then print range", async () => {
    // Bug: :/private const int SIGNAL_SIZE (no closing /) failed with
    // "Unsupported normal mode command: private const int SIGNAL_SIZE"
    const content = [
      "namespace Models {",
      "  public class NodeConfigBufferBuilder {",
      "    private const int SIGNAL_SIZE = 1024;",
      "    private const int BUFFER_SIZE = 2048;",
      "    public void Build() { }",
      "    public void Reset() { }",
      "  }",
      "}"
    ].join('\n');
    const csFile = path.join(testDir, "NodeConfigBufferBuilder.cs");
    await writeFile(csFile, content, "utf-8");

    const result = await manager.callTool("vim", {
      file_path: csFile,
      commands: [
        ":/private const int SIGNAL_SIZE",
        ":.,+5print"
      ]
    });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("private const int SIGNAL_SIZE");
    expect(result.content[0].text).toContain("BUFFER_SIZE");
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

  it("should handle /pattern without trailing slash - Enter executes search", async () => {
    // Search form (no leading :) with no trailing / - use Enter to execute
    const content = [
      "def add(a, b):",
      "    return a + b",
      "def multiply(x, y):",
      "    return x * y"
    ].join("\n");
    await writeFile(testFile, content, "utf-8");

    const result = await manager.callTool("vim", {
      file_path: testFile,
      commands: [
        ":e calc.py",
        "/def multiply",   // No trailing slash
        "\n",              // Enter executes search
        "o",               // Open line below (after jumping to "def multiply")
        "    pass",
        "\x1b",
        ":w"
      ],
    });

    expect(result.isError).toBeFalsy();
    const updatedContent = await readFile(testFile, "utf-8");
    // Should have inserted "pass" after "def multiply" line, not after "def add"
    expect(updatedContent).toContain("def multiply(x, y):\n    pass");
  });

  it("should handle /^if __name__/ without colon - 'i' in pattern must not trigger insert mode", async () => {
    // Bug: When /^if __name__/ is sent char-by-char (no leading :), the "i" in the pattern
    // was incorrectly interpreted as "enter insert mode", causing "f __name__/" to be inserted.
    const content = [
      "def greet(name):",
      "    print(f\"Hello, {name}!\")",
      "",
      "if __name__ == \"__main__\":",
      "    greet(\"World\")"
    ].join('\n');
    const helloFile = path.join(testDir, "hello.py");
    await writeFile(helloFile, content, "utf-8");

    const result = await manager.callTool("vim", {
      file_path: helloFile,
      commands: [
        ":e hello.py",
        "/^if __name__/",   // Search without colon - sent char-by-char; "i" must NOT enter insert mode
        "i",
        "import argparse",
        "",
        "parser = argparse.ArgumentParser()",
        "parser.add_argument(\"--name\", default=\"World\", help=\"Name to greet\")",
        "args = parser.parse_args()",
        "",
        "if __name__ == \"__main__\":",
        "    greet(args.name)",
        "\x1b",
        ":w"
      ]
    });

    expect(result.isError).toBeFalsy();

    const updatedContent = await readFile(helloFile, "utf-8");
    // Must have "import argparse" (not "iimport argparse")
    expect(updatedContent).toContain("import argparse");
    expect(updatedContent).not.toContain("iimport");
    // Must NOT have "f __name__/" inserted as text (bug: "i" triggered insert mode)
    expect(updatedContent).not.toMatch(/f __name__\//);
    expect(updatedContent).toContain("greet(args.name)");
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
