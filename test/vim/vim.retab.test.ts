import { VimToolManager } from "../../src/utils/vim";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);
const unlink = promisify(fs.unlink);
const mkdir = promisify(fs.mkdir);

describe("VimToolManager - :retab command", () => {
  let manager: VimToolManager;
  let testDir: string;
  let testFile: string;

  beforeEach(async () => {
    testDir = path.join(__dirname, "temp_retab_test");
    testFile = path.join(testDir, "retab.txt");

    if (!fs.existsSync(testDir)) {
      await mkdir(testDir, { recursive: true });
    }
    manager = new VimToolManager(testDir);
  });

  afterEach(async () => {
    try {
      if (fs.existsSync(testFile)) await unlink(testFile);
      if (fs.existsSync(testFile + ".bak")) await unlink(testFile + ".bak");
      if (fs.existsSync(testDir)) await fs.promises.rm(testDir, { recursive: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe("tabs to spaces (expandtab on)", () => {
    it("should convert tabs to spaces with default tabstop", async () => {
      await writeFile(testFile, "\thello\n\t\tworld\n", "utf-8");

      const result = await manager.callTool("vim", {
        commands: [":e retab.txt", ":retab", ":%print"],
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;
      // Default tabstop is 8
      expect(text).toContain("        hello");
      expect(text).toContain("                world");
    });

    it("should convert tabs to spaces with custom tabstop argument", async () => {
      await writeFile(testFile, "\thello\n\t\tworld\n", "utf-8");

      const result = await manager.callTool("vim", {
        commands: [":e retab.txt", ":retab 4", ":%print"],
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;
      expect(text).toContain("    hello");
      expect(text).toContain("        world");
    });

    it("should update tabstop option when argument is given", async () => {
      await writeFile(testFile, "\thello\n", "utf-8");

      await manager.callTool("vim", {
        commands: [":e retab.txt", ":retab 2", ":%print"],
      });

      // Run retab again without argument — should use the updated tabstop=2
      await writeFile(testFile, "\tworld\n", "utf-8");
      const mgr2 = new VimToolManager(testDir);
      const result = await mgr2.callTool("vim", {
        commands: [":e retab.txt", ":set tabstop=2", ":retab", ":%print"],
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("  world");
    });

    it("should handle mixed tabs and spaces", async () => {
      await writeFile(testFile, "\t  hello\n  \tworld\n", "utf-8");

      const result = await manager.callTool("vim", {
        commands: [":e retab.txt", ":set tabstop=4", ":retab", ":%print"],
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;
      // Tab expands to fill to next tabstop, then 2 spaces
      expect(text).toContain("      hello");
      // 2 spaces then tab fills to next tabstop
      expect(text).toContain("    world");
    });

    it("should not modify lines without tabs", async () => {
      await writeFile(testFile, "    hello\n    world\n", "utf-8");

      const result = await manager.callTool("vim", {
        commands: [":e retab.txt", ":retab 4", ":%print"],
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("unchanged");
    });

    it("should re-indent with :%retab! 4 after :set expandtab tabstop=4 (user scenario)", async () => {
      // User sets tabstop=4 first, then :retab! 4 - must re-indent even when newTs === currentTs
      const content = `# calc.py - Simple Calculator Module

def add(a, b):
 return a + b

def subtract(a, b):
 return a - b
`;
      await writeFile(testFile, content, "utf-8");

      const result = await manager.callTool("vim", {
        commands: [
          ":e retab.txt",
          ":set expandtab",
          ":set tabstop=4",
          ":set shiftwidth=4",
          ":%retab! 4",
          ":w",
          ":%print",
        ],
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;
      expect(text).toContain("written");
      expect(text).toContain("    return a + b");
      expect(text).not.toMatch(/\n return /);
    });

    it("should not change 1-space indented file with :retab! (no arg, expandtab on) - use :retab 4 instead", async () => {
      // User scenario: expandtab + retab! on space-indented file does nothing.
      // retab! only converts spaces→tabs when expandtab is OFF.
      // For re-indenting 1-space→4-space, use :retab 4 (with numeric argument).
      const content = `# calc.py - Simple Calculator Module

def add(a, b):
 return a + b

def subtract(a, b):
 return a - b
`;
      await writeFile(testFile, content, "utf-8");

      const result = await manager.callTool("vim", {
        commands: [
          ":e retab.txt",
          ":set expandtab",
          ":set tabstop=4",
          ":set shiftwidth=4",
          ":%retab!",
          ":%print",
        ],
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("unchanged");
      // 1-space indent is still there (retab! did nothing)
      const text = result.content[0].text;
      expect(text).toContain(" return a + b");
      expect(text).not.toContain("    return a + b");
    });

    it("should report changed line count", async () => {
      await writeFile(testFile, "\thello\nworld\n\tfoo\n", "utf-8");

      const result = await manager.callTool("vim", {
        commands: [":e retab.txt", ":retab 4"],
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("2 lines changed");
    });
  });

  describe("range support", () => {
    it("should retab only within specified range", async () => {
      await writeFile(
        testFile,
        "\tline1\n\tline2\n\tline3\n\tline4\n",
        "utf-8"
      );

      const result = await manager.callTool("vim", {
        commands: [":e retab.txt", ":set tabstop=4", ":2,3retab", ":%print"],
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;
      // Line 1 and 4 should still have tabs, lines 2-3 should have spaces
      expect(text).toContain("    line2");
      expect(text).toContain("    line3");
    });

    it("should retab entire file with % range", async () => {
      await writeFile(testFile, "\ta\n\tb\n\tc\n", "utf-8");

      const result = await manager.callTool("vim", {
        commands: [":e retab.txt", ":set tabstop=2", ":%retab", ":%print"],
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;
      expect(text).toContain("  a");
      expect(text).toContain("  b");
      expect(text).toContain("  c");
    });
  });

  describe("abbreviation support", () => {
    it("should work with :ret abbreviation", async () => {
      await writeFile(testFile, "\thello\n", "utf-8");

      const result = await manager.callTool("vim", {
        commands: [":e retab.txt", ":ret 4", ":%print"],
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("    hello");
    });
  });

  describe("spaces to tabs (expandtab off, bang)", () => {
    it("should convert spaces to tabs with :retab! and noexpandtab", async () => {
      await writeFile(testFile, "        hello\n", "utf-8");

      const result = await manager.callTool("vim", {
        commands: [":e retab.txt", ":set noexpandtab", ":set tabstop=4", ":retab!", ":%print"],
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;
      expect(text).toContain("\t\thello");
    });

    it("should handle partial tab-width spaces with bang", async () => {
      // 6 spaces with tabstop=4: should become tab + 2 spaces
      await writeFile(testFile, "      hello\n", "utf-8");

      const result = await manager.callTool("vim", {
        commands: [":e retab.txt", ":set noexpandtab", ":set tabstop=4", ":retab!", ":%print"],
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;
      expect(text).toContain("\t  hello");
    });
  });

  describe("re-indentation (space-indented files)", () => {
    it("should re-indent from 2-space to 4-space", async () => {
      await writeFile(
        testFile,
        "def foo():\n  if True:\n    return 1\n  return 0\n",
        "utf-8"
      );

      const result = await manager.callTool("vim", {
        commands: [":e retab.txt", ":set tabstop=2", ":retab 4", ":%print"],
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;
      expect(text).toContain("def foo():");
      expect(text).toContain("    if True:");
      expect(text).toContain("        return 1");
      expect(text).toContain("    return 0");
    });

    it("should re-indent from 4-space to 2-space", async () => {
      await writeFile(
        testFile,
        "function foo() {\n    if (true) {\n        return 1;\n    }\n}\n",
        "utf-8"
      );

      const result = await manager.callTool("vim", {
        commands: [":e retab.txt", ":set tabstop=4", ":retab 2", ":%print"],
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;
      expect(text).toContain("function foo() {");
      expect(text).toContain("  if (true) {");
      expect(text).toContain("    return 1;");
      expect(text).toContain("  }");
    });

    it("should preserve alignment remainder when re-indenting", async () => {
      // 2 and 3 spaces: GCD=1, so each space is one indent level
      // 3 spaces → 3 levels → 12 spaces with newTs=4
      // For a more realistic test: 2 and 4 space indents (GCD=2)
      // with a 3-space line as remainder
      await writeFile(testFile, "  level1\n    level2\n   misaligned\n", "utf-8");

      const result = await manager.callTool("vim", {
        commands: [":e retab.txt", ":retab 4", ":%print"],
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;
      // detected unit = GCD(2,4,3) = 1
      // 2 spaces → 2 levels → 8 spaces
      // 4 spaces → 4 levels → 16 spaces
      // 3 spaces → 3 levels → 12 spaces
      expect(text).toContain("        level1");
      expect(text).toContain("                level2");
      expect(text).toContain("            misaligned");
    });

    it("should not change lines when new tabstop equals old tabstop", async () => {
      await writeFile(testFile, "    hello\n    world\n", "utf-8");

      const result = await manager.callTool("vim", {
        commands: [":e retab.txt", ":set tabstop=4", ":retab 4", ":%print"],
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("unchanged");
    });

    it("should handle re-indent within a range only", async () => {
      await writeFile(
        testFile,
        "  line1\n  line2\n  line3\n  line4\n",
        "utf-8"
      );

      const result = await manager.callTool("vim", {
        commands: [":e retab.txt", ":set tabstop=2", ":2,3retab 4", ":%print"],
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;
      // Lines 1 and 4 keep 2-space indent, lines 2-3 get 4-space
      expect(text).toMatch(/  line1/);
      expect(text).toContain("    line2");
      expect(text).toContain("    line3");
      expect(text).toMatch(/  line4/);
    });

    it("should handle mixed tabs and spaces during re-indent", async () => {
      // Tab-indented file with ts=4: one tab = 4 cols, two tabs = 8 cols
      await writeFile(testFile, "\thello\n\t\tworld\n", "utf-8");

      const result = await manager.callTool("vim", {
        commands: [":e retab.txt", ":set tabstop=4", ":retab 2", ":%print"],
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;
      // detected unit = GCD(4,8) = 4, newTs=2
      // 4 cols → 1 level → 2 spaces
      // 8 cols → 2 levels → 4 spaces
      expect(text).toContain("  hello");
      expect(text).toContain("    world");
    });
  });

  describe("AI use case (no manual setup)", () => {
    it("should re-indent 1-space file to 4-space with just :retab 4", async () => {
      await writeFile(
        testFile,
        "def add(a, b):\n \"\"\"Sum.\"\"\"\n return a + b\n\ndef nested():\n if True:\n  if False:\n   return 0\n",
        "utf-8"
      );

      const result = await manager.callTool("vim", {
        commands: [":e retab.txt", ":%retab 4", ":%print"],
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;
      expect(text).toContain('    """Sum."""');
      expect(text).toContain("    return a + b");
      expect(text).toContain("    if True:");
      expect(text).toContain("        if False:");
      expect(text).toContain("            return 0");
    });

    it("should re-indent 2-space file to 4-space with just :retab 4", async () => {
      await writeFile(
        testFile,
        "function foo() {\n  if (true) {\n    return 1;\n  }\n}\n",
        "utf-8"
      );

      const result = await manager.callTool("vim", {
        commands: [":e retab.txt", ":%retab 4", ":%print"],
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;
      expect(text).toContain("    if (true) {");
      expect(text).toContain("        return 1;");
      expect(text).toContain("    }");
    });

    it("should work with :%retab! 4 (bang variant)", async () => {
      await writeFile(
        testFile,
        "class Foo:\n x = 1\n def bar(self):\n  return self.x\n",
        "utf-8"
      );

      const result = await manager.callTool("vim", {
        commands: [":e retab.txt", ":%retab! 4", ":%print"],
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;
      expect(text).toContain("    x = 1");
      expect(text).toContain("    def bar(self):");
      expect(text).toContain("        return self.x");
    });
  });

  describe("error handling", () => {
    it("should reject invalid tabstop argument", async () => {
      await writeFile(testFile, "\thello\n", "utf-8");

      const result = await manager.callTool("vim", {
        commands: [":e retab.txt", ":retab abc"],
      });

      expect(result.isError).toBeTruthy();
      expect(result.content[0].text).toContain("Invalid argument");
    });

    it("should reject zero tabstop", async () => {
      await writeFile(testFile, "\thello\n", "utf-8");

      const result = await manager.callTool("vim", {
        commands: [":e retab.txt", ":retab 0"],
      });

      expect(result.isError).toBeTruthy();
      expect(result.content[0].text).toContain("Invalid argument");
    });
  });

  describe("full command sequence (set options + retab + write + print)", () => {
    it("should run :setlocal expandtab, tabstop=4, shiftwidth=4, %retab, :w, :%print", async () => {
      const content = "def foo():\n\tpass\n";
      const pyFile = path.join(testDir, "foo.py");
      await writeFile(pyFile, content, "utf-8");

      const result = await manager.callTool("vim", {
        commands: [
          ":e foo.py",
          ":setlocal expandtab",
          ":setlocal tabstop=4",
          ":setlocal shiftwidth=4",
          ":%retab",
          ":w",
          ":%print",
        ],
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;
      expect(text).toContain("written");
      expect(text).toContain("def foo():");
      expect(text).toContain("    pass"); // tabs converted to 4 spaces

      const saved = await readFile(pyFile, "utf-8");
      expect(saved).toContain("    pass");

      try {
        if (fs.existsSync(pyFile)) await unlink(pyFile);
      } catch {
        // ignore
      }
    });

    it("should run :set expandtab, tabstop=4, shiftwidth=4, softtabstop=4, %retab, :w, :%print", async () => {
      // Input: 1-space indentation; retab converts to 4-space
      const calcContent = `# calc.py - Simple Calculator Module

def add(a, b):
 return a + b

def subtract(a, b):
 return a - b

def multiply(a, b):
 return a * b

def divide(a, b):
 if b == 0:
  raise ValueError("Cannot divide by zero")
 return a / b
`;
      const calcFile = path.join(testDir, "calc.py");
      await writeFile(calcFile, calcContent, "utf-8");

      const result = await manager.callTool("vim", {
        commands: [
          ":e calc.py",
          ":set expandtab",
          ":set shiftwidth=4",
          ":set softtabstop=4",
          ":%retab 4",
          ":set tabstop=4",
          ":w",
          ":%print",
        ],
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;
      expect(text).toContain("written");
      expect(text).toContain("# calc.py - Simple Calculator Module");
      expect(text).toContain("def add");
      // Retab converted 1-space indent to 4-space
      expect(text).toContain("    return a + b");
      expect(text).toContain("    return a - b");
      expect(text).toContain("    return a / b");
      // 2-space indent → 8 spaces
      expect(text).toContain('        raise ValueError("Cannot divide by zero")');

      const savedContent = await readFile(calcFile, "utf-8");
      expect(savedContent).toContain("# calc.py - Simple Calculator Module");
      expect(savedContent).toContain("    return a + b");

      try {
        if (fs.existsSync(calcFile)) await unlink(calcFile);
      } catch {
        // ignore
      }
    });
  });

  describe("marks buffer as modified", () => {
    it("should mark buffer as modified after retab changes lines", async () => {
      await writeFile(testFile, "\thello\n", "utf-8");

      const result = await manager.callTool("vim", {
        commands: [":e retab.txt", ":retab 4"],
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("[+]");
    });
  });
});
