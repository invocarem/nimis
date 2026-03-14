import { ExCommandHandler } from "../src/utils/vim/commands/ExCommandHandler";
import { VimBuffer, CommandContext, VIM_OPTION_DEFAULTS } from "../src/utils/vim/types";
import { createBuffer } from "../src/utils/vim/models/VimBuffer";
import { VimToolManager } from "../src/utils/vim";
import * as fs from "fs";
import * as path from "path";

describe("ExCommandHandler - :c (change) command", () => {
  let handler: ExCommandHandler;
  let ctx: CommandContext;
  let buffer: VimBuffer;

  beforeEach(() => {
    ctx = {
      buffers: new Map(),
      getCurrentBuffer: jest.fn(),
      setCurrentBuffer: jest.fn(),
      workingDir: "/test",
      resolvePath: (filePath: string) =>
        filePath.startsWith("/") ? filePath : `/test/${filePath}`,
      options: { ...VIM_OPTION_DEFAULTS },
    } as any;

    buffer = createBuffer(
      "/test/file.txt",
      ["line 1", "line 2", "line 3", "line 4", "line 5"],
      "\n"
    );
    handler = new ExCommandHandler(ctx);
  });

  describe("inline c\\ form", () => {
    it("should replace a single line with c\\text", async () => {
      buffer.currentLine = 1;
      const result = await handler.execute("c\\replaced line", buffer);
      expect(result).toContain("Changed 1 line(s) to 1 line(s)");
      expect(buffer.content[1]).toBe("replaced line");
      expect(buffer.content).toHaveLength(5);
    });

    it("should replace a single line with multi-line text using \\n", async () => {
      buffer.currentLine = 0;
      const result = await handler.execute("c\\first\\nsecond\\nthird", buffer);
      expect(result).toContain("Changed 1 line(s) to 3 line(s)");
      expect(buffer.content[0]).toBe("first");
      expect(buffer.content[1]).toBe("second");
      expect(buffer.content[2]).toBe("third");
      expect(buffer.content).toHaveLength(7);
    });

    it("should work with % range to replace entire file", async () => {
      const result = await handler.execute("%c\\only line", buffer);
      expect(result).toContain("Changed 5 line(s) to 1 line(s)");
      expect(buffer.content).toEqual(["only line"]);
    });

    it("should work with numeric range", async () => {
      const result = await handler.execute("2,4c\\replacement", buffer);
      expect(result).toContain("Changed 3 line(s) to 1 line(s)");
      expect(buffer.content).toEqual(["line 1", "replacement", "line 5"]);
    });

    it("should work with search pattern range", async () => {
      const result = await handler.execute(
        "/line 2/c\\new line 2",
        buffer
      );
      expect(result).toContain("Changed 1 line(s) to 1 line(s)");
      expect(buffer.content[1]).toBe("new line 2");
      expect(buffer.content).toHaveLength(5);
    });
  });

  describe("space-separated c form", () => {
    it("should replace current line with :c text", async () => {
      buffer.currentLine = 2;
      const result = await handler.execute("c replaced text", buffer);
      expect(result).toContain("Changed 1 line(s) to 1 line(s)");
      expect(buffer.content[2]).toBe("replaced text");
    });

    it("should support \\n for newlines in space-separated form", async () => {
      buffer.currentLine = 0;
      const result = await handler.execute("c alpha\\nbeta", buffer);
      expect(result).toContain("Changed 1 line(s) to 2 line(s)");
      expect(buffer.content[0]).toBe("alpha");
      expect(buffer.content[1]).toBe("beta");
    });

    it("should fall back to delete when no text is given", async () => {
      buffer.currentLine = 2;
      const result = await handler.execute("c", buffer);
      expect(result).toContain("Deleted");
      expect(buffer.content).toHaveLength(4);
    });
  });

  describe("abbreviations", () => {
    it("should accept :ch as abbreviation", async () => {
      buffer.currentLine = 0;
      const result = await handler.execute("ch new", buffer);
      expect(result).toContain("Changed");
      expect(buffer.content[0]).toBe("new");
    });

    it("should accept :change as full name", async () => {
      buffer.currentLine = 0;
      const result = await handler.execute("change new", buffer);
      expect(result).toContain("Changed");
      expect(buffer.content[0]).toBe("new");
    });

    it("should accept :change\\ inline form", async () => {
      buffer.currentLine = 0;
      const result = await handler.execute("change\\new text", buffer);
      expect(result).toContain("Changed");
      expect(buffer.content[0]).toBe("new text");
    });
  });

  describe("register and cursor behavior", () => {
    it("should store deleted text in unnamed register", async () => {
      buffer.currentLine = 1;
      await handler.execute("c\\replacement", buffer);
      const reg = buffer.registers.get('"');
      expect(reg).toBeDefined();
      expect(reg!.content).toEqual(["line 2"]);
    });

    it("should set cursor to last inserted line", async () => {
      buffer.currentLine = 0;
      await handler.execute("c\\a\\nb\\nc", buffer);
      expect(buffer.currentLine).toBe(2);
    });

    it("should mark buffer as modified", async () => {
      buffer.modified = false;
      buffer.currentLine = 0;
      await handler.execute("c\\changed", buffer);
      expect(buffer.modified).toBe(true);
    });

    it("should adjust marks after change", async () => {
      buffer.marks.set("a", 4);
      await handler.execute("2,3c\\single line", buffer);
      // Mark at line 4 (0-indexed) should shift up by 1 (removed 2 lines, inserted 1)
      expect(buffer.marks.get("a")).toBe(3);
    });

    it("should remove marks within replaced range", async () => {
      buffer.marks.set("a", 1);
      buffer.marks.set("b", 2);
      await handler.execute("2,3c\\replaced", buffer);
      expect(buffer.marks.has("a")).toBe(false);
      expect(buffer.marks.has("b")).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("should handle replacing with empty string", async () => {
      buffer.currentLine = 0;
      await handler.execute("c\\", buffer);
      expect(buffer.content[0]).toBe("");
      expect(buffer.content).toHaveLength(5);
    });

    it("should handle replacing all lines with multi-line text", async () => {
      await handler.execute("%c\\alpha\\nbeta\\ngamma", buffer);
      expect(buffer.content).toEqual(["alpha", "beta", "gamma"]);
    });

    it("should handle replacing last line", async () => {
      buffer.currentLine = 4;
      await handler.execute("c\\new last", buffer);
      expect(buffer.content[4]).toBe("new last");
      expect(buffer.content).toHaveLength(5);
    });

    it("should handle single-line buffer", async () => {
      const singleBuf = createBuffer("/test/single.txt", ["only"], "\n");
      singleBuf.currentLine = 0;
      const result = await handler.execute("c\\replaced", singleBuf);
      expect(result).toContain("Changed 1 line(s) to 1 line(s)");
      expect(singleBuf.content).toEqual(["replaced"]);
    });
  });
});

describe("VimToolManager - :c (change) integration", () => {
  let manager: VimToolManager;
  let testDir: string;
  let testFile: string;

  beforeEach(async () => {
    testDir = path.join(__dirname, "temp_change_test");
    testFile = path.join(testDir, "calc.py");

    if (!fs.existsSync(testDir)) {
      await fs.promises.mkdir(testDir, { recursive: true });
    }

    await fs.promises.writeFile(
      testFile,
      [
        "import sys",
        "",
        "def add(a, b): return a + b",
        "def subtract(a, b): return a - b",
        "",
        "if len(sys.argv) != 4:",
        '    print("Usage: python calc.py <op> <num1> <num2>")',
        "    sys.exit(1)",
        "",
        "op, a, b = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])",
        "result = operations[op](a, b)",
        'print(f"Result: {result}")',
      ].join("\n") + "\n"
    );

    manager = new VimToolManager(testDir);
  });

  afterEach(async () => {
    try {
      if (fs.existsSync(testDir)) {
        const files = await fs.promises.readdir(testDir);
        for (const file of files) {
          await fs.promises.unlink(path.join(testDir, file));
        }
        await fs.promises.rmdir(testDir);
      }
    } catch {
      // ignore cleanup errors
    }
  });

  it("should change a single line using pattern search + c\\", async () => {
    const result = await manager.callTool("vim", {
      commands: [
        ":e calc.py",
        ":/op, a, b = sys.argv/c\\    op = sys.argv[1]\\n    a = float(sys.argv[2])\\n    b = float(sys.argv[3]) if len(sys.argv) > 3 else None",
        ":w",
      ],
    });
    expect(result.isError).toBeFalsy();

    const content = await fs.promises.readFile(testFile, "utf-8");
    expect(content).toContain("    op = sys.argv[1]");
    expect(content).toContain("    a = float(sys.argv[2])");
    expect(content).toContain(
      "    b = float(sys.argv[3]) if len(sys.argv) > 3 else None"
    );
    expect(content).not.toContain("op, a, b = sys.argv[1], float(sys.argv[2])");
  });

  it("should change a range of lines using numeric range + c\\", async () => {
    const result = await manager.callTool("vim", {
      commands: [":e calc.py", ":3,4c\\def add(a, b): return a + b\\ndef subtract(a, b): return a - b\\ndef multiply(a, b): return a * b", ":w"],
    });
    expect(result.isError).toBeFalsy();

    const content = await fs.promises.readFile(testFile, "utf-8");
    expect(content).toContain("def multiply(a, b): return a * b");
  });

  it("should work in combination with substitute commands", async () => {
    const result = await manager.callTool("vim", {
      commands: [
        ":e calc.py",
        ':%s/if len.sys\\.argv. != 4:/if len(sys.argv) < 3 or len(sys.argv) > 4:/',
        ":/op, a, b = sys.argv/c\\    op = sys.argv[1]\\n    a = float(sys.argv[2])\\n    b = float(sys.argv[3]) if len(sys.argv) > 3 else None",
        ":w",
      ],
    });
    expect(result.isError).toBeFalsy();

    const content = await fs.promises.readFile(testFile, "utf-8");
    expect(content).toContain("if len(sys.argv) < 3 or len(sys.argv) > 4:");
    expect(content).toContain("    op = sys.argv[1]");
  });
});
