// test/vim/vim.externalCommand.test.ts
import { VimToolManager } from "../../src/utils/vim";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);
const unlink = promisify(fs.unlink);
const mkdir = promisify(fs.mkdir);

describe("VimToolManager - :! (external command)", () => {
  let manager: VimToolManager;
  let testDir: string;
  let testFile: string;

  beforeEach(async () => {
    testDir = path.join(__dirname, "temp_external_test");
    testFile = path.join(testDir, "test.txt");

    if (!fs.existsSync(testDir)) {
      await mkdir(testDir, { recursive: true });
    }

    manager = new VimToolManager(testDir);
  });

  afterEach(async () => {
    try {
      for (const f of await fs.promises.readdir(testDir)) {
        const full = path.join(testDir, f);
        if (fs.statSync(full).isFile()) await unlink(full);
      }
      await fs.promises.rmdir(testDir);
    } catch {
      // Ignore cleanup errors
    }
  });

  describe(":! without range (run and display)", () => {
    it("should return command stdout without modifying the buffer", async () => {
      await writeFile(testFile, "line 1\nline 2\nline 3\n", "utf-8");

      const result = await manager.callTool("vim", {
      commands: [":e test.txt", ":!echo hello"],
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("hello");

      // Buffer should NOT be modified
      const onDisk = await readFile(testFile, "utf-8");
      expect(onDisk).toBe("line 1\nline 2\nline 3\n");
    });

    it("should return multi-line command output", async () => {
      await writeFile(testFile, "unchanged\n", "utf-8");

      const result = await manager.callTool("vim", {
      commands: [":e test.txt", ":!echo -e 'alpha\\nbeta\\ngamma'"],
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;
      expect(text).toContain("alpha");
      expect(text).toContain("beta");
      expect(text).toContain("gamma");
    });

    it("should not mark the buffer as modified", async () => {
      await writeFile(testFile, "original\n", "utf-8");

      const result = await manager.callTool("vim", {
      commands: [":e test.txt", ":!echo test"],
      });

      expect(result.isError).toBeFalsy();
      // The buffer status indicator should show unmodified (no '+')
      expect(result.content[0].text).toMatch(/\[\]\s*Mode:/);
    });

    it("should handle :! without a buffer (directory-only mode)", async () => {
      const result = await manager.callTool("vim", {
        commands: [":!echo from_shell"],
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("from_shell");
    });
  });

  describe(":[range]! (filter through command)", () => {
    it("should filter the entire buffer with %!sort", async () => {
      await writeFile(testFile, "cherry\napple\nbanana\n", "utf-8");

      const result = await manager.callTool("vim", {
      commands: [":e test.txt", ":%!sort", ":%print"],
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text!;
      expect(text).toContain("apple");
      // Verify sorted order: apple before banana before cherry
      const appleIdx = text.indexOf("apple");
      const bananaIdx = text.indexOf("banana");
      const cherryIdx = text.indexOf("cherry");
      expect(appleIdx).toBeLessThan(bananaIdx);
      expect(bananaIdx).toBeLessThan(cherryIdx);
    });

    it("should filter a line range", async () => {
      await writeFile(
        testFile,
        "header\ncherry\napple\nbanana\nfooter\n",
        "utf-8"
      );

      const result = await manager.callTool("vim", {
      commands: [":e test.txt", ":2,4!sort", ":%print"],
      });

      expect(result.isError).toBeFalsy();
      const text = result.content[0].text!;
      // header and footer should be untouched
      expect(text).toContain("header");
      expect(text).toContain("footer");
      // The middle lines should be sorted
      const lines = text.split("\n");
      const printedLines = lines.filter(
        (l) =>
          l === "header" ||
          l === "apple" ||
          l === "banana" ||
          l === "cherry" ||
          l === "footer"
      );
      expect(printedLines).toEqual([
        "header",
        "apple",
        "banana",
        "cherry",
        "footer",
      ]);
    });

    it("should mark the buffer as modified after filtering", async () => {
      await writeFile(testFile, "b\na\nc\n", "utf-8");

      const result = await manager.callTool("vim", {
      commands: [":e test.txt", ":%!sort"],
      });

      expect(result.isError).toBeFalsy();
      // The '+' marker indicates the buffer was modified
      expect(result.content[0].text).toMatch(/\[\+\]\s*Mode:/);
    });

    it("should replace filtered lines with command output", async () => {
      await writeFile(testFile, "3\n1\n2\n", "utf-8");

      const result = await manager.callTool("vim", {
      commands: [":e test.txt", ":%!sort -n", ":w", ":%print"],
      });

      expect(result.isError).toBeFalsy();
      const saved = await readFile(testFile, "utf-8");
      expect(saved.trimEnd()).toBe("1\n2\n3");
    });
  });

  describe("Error handling", () => {
    it("should error when :! is given no command", async () => {
      await writeFile(testFile, "content\n", "utf-8");

      const result = await manager.callTool("vim", {
      commands: [":e test.txt", ":!"],
      });

      expect(result.isError).toBeTruthy();
      expect(result.content[0].text).toContain("requires a shell command");
    });

    it("should error when the shell command fails", async () => {
      await writeFile(testFile, "content\n", "utf-8");

      const result = await manager.callTool("vim", {
      commands: [":e test.txt", ":!nonexistent_command_xyz_12345"],
      });

      expect(result.isError).toBeTruthy();
    });
  });
});
