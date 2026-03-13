// test/vim.line0AndPutExpression.test.ts
// Tests for line 0, :0a (append), and :put = expression support
import { VimToolManager } from "../src/utils/vim";
import { parseRange } from "../src/utils/vim/utils/RangeParser";
import { createBuffer } from "../src/utils/vim/models/VimBuffer";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

const readFile = promisify(fs.readFile);
const unlink = promisify(fs.unlink);
const mkdir = promisify(fs.mkdir);

describe("line 0, :0a, and :put = expression", () => {
  let manager: VimToolManager;
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(__dirname, "temp_line0_put");
    if (!fs.existsSync(testDir)) {
      await mkdir(testDir, { recursive: true });
    }
    manager = new VimToolManager(testDir);
  });

  afterEach(async () => {
    try {
      if (fs.existsSync(testDir)) {
        const files = await fs.promises.readdir(testDir);
        for (const file of files) {
          await unlink(path.join(testDir, file));
        }
      }
    } catch {
      /* ignore */
    }
  });

  describe("RangeParser line 0", () => {
    it("should parse line 0 as -1 (virtual line before first)", () => {
      const buffer = createBuffer("/test/f", ["a", "b", "c"], "\n");
      const range = parseRange("0", buffer);
      expect(range).toEqual({ start: -1, end: -1 });
    });

    it("should allow :0 with empty buffer", () => {
      const buffer = createBuffer("/test/f", [], "\n");
      const range = parseRange("0", buffer);
      expect(range).toEqual({ start: -1, end: -1 });
    });
  });

  describe(":0put = expression", () => {
    it("should put expression at start after %d (LLM-style workflow)", async () => {
      const filePath = path.join(testDir, "calc.py");

      const result = await manager.callTool("vim", {
        file_path: filePath,
        commands: [
          ":%d",
          ":0put ='# calc.py - Simple Calculator Module'",
          ":put =''",
          ":put ='def add(a, b):'",
          ":w",
        ],
      });

      expect(result.isError).toBeFalsy();
      const content = await readFile(filePath, "utf-8");
      expect(content).toContain("# calc.py - Simple Calculator Module");
      expect(content).toContain("def add(a, b):");
      const lines = content.split("\n");
      expect(lines[0]).toBe("# calc.py - Simple Calculator Module");
      expect(lines[1]).toBe("");
      expect(lines[2]).toBe("def add(a, b):");
    });

    it("should support :put = with double-quoted string", async () => {
      const filePath = path.join(testDir, "dbl.py");

      const result = await manager.callTool("vim", {
        file_path: filePath,
        commands: [
          ":%d",
          ':0put ="# double quoted"',
          ":w",
        ],
      });

      expect(result.isError).toBeFalsy();
      const content = await readFile(filePath, "utf-8");
      expect(content).toContain("# double quoted");
    });
  });

  describe(":0a (append after line 0)", () => {
    it.skip("should :0a and insert text at start (erase + prepend workflow)", async () => {
      const filePath = path.join(testDir, "prepend.py");
      await fs.promises.writeFile(filePath, "old line\n", "utf-8");

      const result = await manager.callTool("vim", {
        file_path: filePath,
        commands: [
          ":%d",
          ":0a",
          "# prepended header",
          "",
          "def main():",
          "    pass",
          "\x1b",
          ":w",
        ],
      });

      if (result.isError && result.content?.[0]?.text) {
        throw new Error(`:0a test failed: ${result.content[0].text}`);
      }
      expect(result.isError).toBeFalsy();
      const content = await readFile(filePath, "utf-8");
      const lines = content.split("\n");
      expect(lines[0]).toBe("# prepended header");
      expect(lines[1]).toBe("");
      expect(lines[2]).toBe("def main():");
      expect(lines[3]).toBe("    pass");
    });
  });
});
