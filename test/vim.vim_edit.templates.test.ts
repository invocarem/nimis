/**
 * Validates that every vim tool call in vim_templates.xml parses to the correct
 * args shape and that the format is executable by VimToolManager.
 */
import * as fs from "fs";
import * as path from "path";
import { XmlProcessor } from "../src/utils/xmlProcessor";
import { VimToolManager } from "../src/utils/vim";

const templatesPath = path.join(
  __dirname,
  "..",
  "src",
  "utils",
  "templates",
  "vim_templates.xml"
);

describe("vim tool calls in vim_templates.xml", () => {
  let xmlContent: string;

  beforeAll(() => {
    xmlContent = fs.readFileSync(templatesPath, "utf-8");
  });

  describe("parsing", () => {
    it("should parse all tool calls from vim_templates.xml", () => {
      const toolCalls = XmlProcessor.extractToolCalls(xmlContent);
      expect(toolCalls.length).toBeGreaterThan(0);
    });

    it("should have every tool call named vim", () => {
      const toolCalls = XmlProcessor.extractToolCalls(xmlContent);
      for (const tc of toolCalls) {
        expect(tc.name).toBe("vim");
      }
    });

    it("should have valid args for each vim: commands array", () => {
      const toolCalls = XmlProcessor.extractToolCalls(xmlContent);
      for (let i = 0; i < toolCalls.length; i++) {
        const tc = toolCalls[i];
        expect(tc.args).toBeDefined();
        expect(Array.isArray(tc.args.commands)).toBe(true);
        expect((tc.args.commands as string[]).length).toBeGreaterThan(0);
        for (const cmd of tc.args.commands as string[]) {
          expect(typeof cmd).toBe("string");
        }
      }
    });

    it("should have file_path as string when present", () => {
      const toolCalls = XmlProcessor.extractToolCalls(xmlContent);
      for (const tc of toolCalls) {
        if (tc.args.file_path !== undefined) {
          expect(typeof tc.args.file_path).toBe("string");
          expect(tc.args.file_path.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe("execution via VimToolManager", () => {
    let manager: VimToolManager;
    let testDir: string;
    let testFile: string;

    beforeEach(async () => {
      testDir = path.join(__dirname, "temp_vim_templates_test");
      testFile = path.join(testDir, "index.ts");
      if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
      }
      manager = new VimToolManager(testDir);
    });

    afterEach(() => {
      try {
        if (fs.existsSync(testDir)) {
          const files = fs.readdirSync(testDir);
          for (const f of files) {
            fs.unlinkSync(path.join(testDir, f));
          }
          fs.rmdirSync(testDir);
        }
      } catch {
        // ignore
      }
    });

    it("should execute a parsed tool call (read file) when args are passed to callTool", async () => {
      await fs.promises.writeFile(testFile, "const x = 1;\n", "utf-8");
      const args = {
        file_path: testFile,
        commands: [":e index.ts", ":%print"],
      };
      const result = await manager.callTool("vim", args);
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("const x = 1;");
    });

    it("should execute a parsed tool call (insert and save) when args match template format", async () => {
      const args = {
        file_path: testFile,
        commands: [
          ":e index.ts",
          "i",
          "hello from template",
          "\x1b",
          ":w",
        ],
      };
      const result = await manager.callTool("vim", args);
      expect(result.isError).toBeFalsy();
      const content = await fs.promises.readFile(testFile, "utf-8");
      expect(content).toContain("hello from template");
    });

    it("should execute one real template tool call from XML with path substituted", async () => {
      const toolCalls = XmlProcessor.extractToolCalls(xmlContent);
      const readTemplate = toolCalls.find(
        (tc) =>
          tc.args.commands &&
          (tc.args.commands as string[]).some((c: string) => /:%print/.test(c)) &&
          (tc.args.commands as string[]).length <= 5
      );
      expect(readTemplate).toBeDefined();

      await fs.promises.writeFile(testFile, "line1\nline2\n", "utf-8");
      const args = {
        file_path: testFile,
        commands: (readTemplate!.args.commands as string[]).map((c: string) =>
          c.replace(/src\/index\.ts/g, "index.ts")
        ),
      };
      const result = await manager.callTool("vim", args);
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("line1");
      expect(result.content[0].text).toContain("line2");
    });
  });
});
