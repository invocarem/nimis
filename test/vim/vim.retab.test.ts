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
        file_path: testFile,
        commands: [":retab", ":%print"],
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
        file_path: testFile,
        commands: [":retab 4", ":%print"],
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;
      expect(text).toContain("    hello");
      expect(text).toContain("        world");
    });

    it("should update tabstop option when argument is given", async () => {
      await writeFile(testFile, "\thello\n", "utf-8");

      await manager.callTool("vim", {
        file_path: testFile,
        commands: [":retab 2", ":%print"],
      });

      // Run retab again without argument — should use the updated tabstop=2
      await writeFile(testFile, "\tworld\n", "utf-8");
      const mgr2 = new VimToolManager(testDir);
      const result = await mgr2.callTool("vim", {
        file_path: testFile,
        commands: [":set tabstop=2", ":retab", ":%print"],
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("  world");
    });

    it("should handle mixed tabs and spaces", async () => {
      await writeFile(testFile, "\t  hello\n  \tworld\n", "utf-8");

      const result = await manager.callTool("vim", {
        file_path: testFile,
        commands: [":set tabstop=4", ":retab", ":%print"],
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
        file_path: testFile,
        commands: [":retab 4", ":%print"],
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("unchanged");
    });

    it("should report changed line count", async () => {
      await writeFile(testFile, "\thello\nworld\n\tfoo\n", "utf-8");

      const result = await manager.callTool("vim", {
        file_path: testFile,
        commands: [":retab 4"],
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
        file_path: testFile,
        commands: [":set tabstop=4", ":2,3retab", ":%print"],
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
        file_path: testFile,
        commands: [":set tabstop=2", ":%retab", ":%print"],
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
        file_path: testFile,
        commands: [":ret 4", ":%print"],
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("    hello");
    });
  });

  describe("spaces to tabs (expandtab off, bang)", () => {
    it("should convert spaces to tabs with :retab! and noexpandtab", async () => {
      await writeFile(testFile, "        hello\n", "utf-8");

      const result = await manager.callTool("vim", {
        file_path: testFile,
        commands: [":set noexpandtab", ":set tabstop=4", ":retab!", ":%print"],
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;
      expect(text).toContain("\t\thello");
    });

    it("should handle partial tab-width spaces with bang", async () => {
      // 6 spaces with tabstop=4: should become tab + 2 spaces
      await writeFile(testFile, "      hello\n", "utf-8");

      const result = await manager.callTool("vim", {
        file_path: testFile,
        commands: [":set noexpandtab", ":set tabstop=4", ":retab!", ":%print"],
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;
      expect(text).toContain("\t  hello");
    });
  });

  describe("error handling", () => {
    it("should reject invalid tabstop argument", async () => {
      await writeFile(testFile, "\thello\n", "utf-8");

      const result = await manager.callTool("vim", {
        file_path: testFile,
        commands: [":retab abc"],
      });

      expect(result.isError).toBeTruthy();
      expect(result.content[0].text).toContain("Invalid argument");
    });

    it("should reject zero tabstop", async () => {
      await writeFile(testFile, "\thello\n", "utf-8");

      const result = await manager.callTool("vim", {
        file_path: testFile,
        commands: [":retab 0"],
      });

      expect(result.isError).toBeTruthy();
      expect(result.content[0].text).toContain("Invalid argument");
    });
  });

  describe("marks buffer as modified", () => {
    it("should mark buffer as modified after retab changes lines", async () => {
      await writeFile(testFile, "\thello\n", "utf-8");

      const result = await manager.callTool("vim", {
        file_path: testFile,
        commands: [":retab 4"],
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("[+]");
    });
  });
});
