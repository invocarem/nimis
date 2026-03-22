// test/vim/vim.visualMode.test.ts
import { VimToolManager } from "../../src/utils/vim";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);
const mkdir = promisify(fs.mkdir);

describe("Visual Line Mode", () => {
  let manager: VimToolManager;
  let testDir: string;
  let testFile: string;

  beforeEach(async () => {
    testDir = path.join(__dirname, "temp_visual_test");
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

  describe("ggVG= (select all, reindent)", () => {
    it("should reindent entire file", async () => {
      const content = "function foo() {\n  return {\n  a: 1,\n  b: 2\n};\n}\n";
      await writeFile(testFile, content, "utf-8");

      const result = await manager.callTool("vim", {
        commands: [":e test.txt", ":set shiftwidth=2", "ggVG=", ":w"]
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Reindented");
      const out = await readFile(testFile, "utf-8");
      expect(out).toContain("    a: 1");
      expect(out).toContain("    b: 2");
      expect(out).toContain("  };");
    });
  });

  describe("V + G + = (select to end, reindent)", () => {
    it("should reindent from current line to end", async () => {
      const content = "x\n  y\n  z\n";
      await writeFile(testFile, content, "utf-8");
      await manager.callTool("vim", { commands: [":e! test.txt", ":set shiftwidth=2"] });

      await manager.callTool("vim", {
        commands: ["2G", "VG=", ":w"]
      });

      const out = await readFile(testFile, "utf-8");
      expect(out).toBe("x\n  y\n  z\n");
    });
  });

  describe("V + j/k (select lines, reindent)", () => {
    it("should reindent 3 lines with Vjj=", async () => {
      const content = "if (x) {\n  y();\n}\nmore();\n";
      await writeFile(testFile, content, "utf-8");
      await manager.callTool("vim", { commands: [":e! test.txt", ":set shiftwidth=2"] });

      await manager.callTool("vim", {
        commands: ["1G", "Vjj=", ":w"]
      });

      const out = await readFile(testFile, "utf-8");
      expect(out).toContain("if (x) {");
      expect(out).toContain("  y();");
      expect(out).toContain("}");
      expect(out).toContain("more();");
    });
  });

  describe("Esc to cancel", () => {
    it("should cancel visual mode and leave buffer unchanged", async () => {
      const content = "line1\nline2\nline3\n";
      await writeFile(testFile, content, "utf-8");
      await manager.callTool("vim", { commands: [":e test.txt"] });

      const result = await manager.callTool("vim", {
        commands: ["2G", "V", "j", "\x1b"]
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("NORMAL");
      const out = await readFile(testFile, "utf-8");
      expect(out).toBe("line1\nline2\nline3\n");
    });
  });
});
