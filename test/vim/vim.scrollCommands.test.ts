// test/vim/vim.scrollCommands.test.ts
import { VimToolManager } from "../../src/utils/vim";
import { VimStateMachine } from "../../src/utils/vim/commands/VimStateMachine";
import { VimBuffer, CommandContext, VIM_OPTION_DEFAULTS } from "../../src/utils/vim/types";
import { createBuffer } from "../../src/utils/vim/models/VimBuffer";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);
const mkdir = promisify(fs.mkdir);

describe("Vim scroll commands", () => {
  describe("zt, zz, zb - viewport scroll (NormalCommandHandler)", () => {
    let stateMachine: VimStateMachine;
    let mockBuffer: VimBuffer;
    let mockContext: CommandContext;

    beforeEach(() => {
      mockContext = {
        buffers: new Map(),
        getCurrentBuffer: jest.fn(),
        setCurrentBuffer: jest.fn(),
        resolvePath: (fp: string) => fp,
        options: { ...VIM_OPTION_DEFAULTS },
      } as any;
      mockBuffer = createBuffer("/test/file.txt", Array(50).fill("x").map((x, i) => `line ${i + 1}`), "\n");
      mockBuffer.currentLine = 25;
      stateMachine = new VimStateMachine(mockContext);
      stateMachine.setBuffer(mockBuffer);
      (stateMachine.getState() as any).cursorPosition.line = 25;
    });

    it("zt should set viewportTop to current line (scroll current line to top)", async () => {
      await stateMachine.processKey("z");
      await stateMachine.processKey("t");
      expect(mockBuffer.viewportTop).toBe(25);
    });

    it("zz should set viewportTop so current line is in middle", async () => {
      await stateMachine.processKey("z");
      await stateMachine.processKey("z");
      expect(mockBuffer.viewportTop).toBe(13); // 25 - 12
    });

    it("zb should set viewportTop so current line is at bottom", async () => {
      await stateMachine.processKey("z");
      await stateMachine.processKey("b");
      expect(mockBuffer.viewportTop).toBe(2); // 25 - 23
    });

    it("zb at line 5 should clamp viewportTop to 0", async () => {
      mockBuffer.currentLine = 5;
      (stateMachine.getState() as any).cursorPosition.line = 5;
      await stateMachine.processKey("z");
      await stateMachine.processKey("b");
      expect(mockBuffer.viewportTop).toBe(0);
    });
  });

  describe("Ctrl+F, Ctrl+B, Ctrl+D, Ctrl+U - page scroll", () => {
    let stateMachine: VimStateMachine;
    let mockBuffer: VimBuffer;
    let mockContext: CommandContext;

    beforeEach(() => {
      mockContext = {
        buffers: new Map(),
        getCurrentBuffer: jest.fn(),
        setCurrentBuffer: jest.fn(),
        resolvePath: (fp: string) => fp,
        options: { ...VIM_OPTION_DEFAULTS },
      } as any;
      mockBuffer = createBuffer("/test/file.txt", Array(50).fill("x").map((x, i) => `line ${i + 1}`), "\n");
      mockBuffer.currentLine = 10;
      mockBuffer.viewportTop = 0;
      stateMachine = new VimStateMachine(mockContext);
      stateMachine.setBuffer(mockBuffer);
      (stateMachine.getState() as any).cursorPosition.line = 10;
    });

    it("Ctrl+F should page down (viewport +24, cursor +24)", async () => {
      await stateMachine.processKey("\x06");
      expect(mockBuffer.viewportTop).toBe(24);
      expect(mockBuffer.currentLine).toBe(34);
    });

    it("Ctrl+B should page up (viewport -24, cursor -24)", async () => {
      mockBuffer.currentLine = 30;
      mockBuffer.viewportTop = 26;
      (stateMachine.getState() as any).cursorPosition.line = 30;
      await stateMachine.processKey("\x02");
      expect(mockBuffer.viewportTop).toBe(2);
      expect(mockBuffer.currentLine).toBe(6);
    });

    it("Ctrl+D should half page down", async () => {
      await stateMachine.processKey("\x04");
      expect(mockBuffer.viewportTop).toBe(12);
      expect(mockBuffer.currentLine).toBe(22);
    });

    it("Ctrl+U should half page up", async () => {
      mockBuffer.currentLine = 20;
      mockBuffer.viewportTop = 12;
      (stateMachine.getState() as any).cursorPosition.line = 20;
      await stateMachine.processKey("\x15");
      expect(mockBuffer.viewportTop).toBe(0);
      expect(mockBuffer.currentLine).toBe(8);
    });

    it("Ctrl+F should clamp cursor at end of file", async () => {
      mockBuffer.currentLine = 45;
      mockBuffer.viewportTop = 26;
      (stateMachine.getState() as any).cursorPosition.line = 45;
      await stateMachine.processKey("\x06");
      expect(mockBuffer.currentLine).toBe(49);
      expect(mockBuffer.viewportTop).toBe(26);
    });

    it("Ctrl+B should clamp viewportTop to 0", async () => {
      mockBuffer.currentLine = 5;
      mockBuffer.viewportTop = 5;
      (stateMachine.getState() as any).cursorPosition.line = 5;
      await stateMachine.processKey("\x02");
      expect(mockBuffer.viewportTop).toBe(0);
      expect(mockBuffer.currentLine).toBe(0);
    });
  });

  describe("Literal Ctrl+b, Ctrl+f, Ctrl+d, Ctrl+u normalization (VimToolManager)", () => {
    let manager: VimToolManager;
    let testDir: string;
    let testFile: string;

    beforeEach(async () => {
      testDir = path.join(__dirname, "temp_scroll_test");
      testFile = path.join(testDir, "scroll.txt");
      if (!fs.existsSync(testDir)) {
        await mkdir(testDir, { recursive: true });
      }
      const content = Array(50)
        .fill(0)
        .map((_, i) => `line ${i + 1}`)
        .join("\n");
      await writeFile(testFile, content + "\n", "utf-8");
      manager = new VimToolManager(testDir);
    });

    afterEach(async () => {
      try {
        if (fs.existsSync(testFile)) await unlink(testFile);
        if (fs.existsSync(testDir)) {
          const files = await fs.promises.readdir(testDir);
          for (const f of files) await unlink(path.join(testDir, f));
        }
      } catch {
        // ignore
      }
    });

    it('should handle literal "Ctrl+b" as page up', async () => {
      const result = await manager.callTool("vim", {
        commands: [
          ":e test.txt","30G", "Ctrl+b"],
      });
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Page up");
    });

    it('should handle literal "Ctrl+f" as page down', async () => {
      const result = await manager.callTool("vim", {
        commands: [
          ":e test.txt","Ctrl+f"],
      });
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Page down");
    });

    it('should handle literal "Ctrl+d" as half page down', async () => {
      const result = await manager.callTool("vim", {
        commands: [
          ":e test.txt","Ctrl+d"],
      });
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Half page down");
    });

    it('should handle literal "Ctrl+u" as half page up', async () => {
      const result = await manager.callTool("vim", {
        commands: [
          ":e test.txt","20G", "Ctrl+u"],
      });
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Half page up");
    });
  });

  describe("zt, zz, zb via VimToolManager (integration)", () => {
    let manager: VimToolManager;
    let testDir: string;
    let testFile: string;

    beforeEach(async () => {
      testDir = path.join(__dirname, "temp_scroll_test");
      testFile = path.join(testDir, "scroll.txt");
      if (!fs.existsSync(testDir)) {
        await mkdir(testDir, { recursive: true });
      }
      const content = Array(50)
        .fill(0)
        .map((_, i) => `line ${i + 1}`)
        .join("\n");
      await writeFile(testFile, content + "\n", "utf-8");
      manager = new VimToolManager(testDir);
    });

    afterEach(async () => {
      try {
        if (fs.existsSync(testFile)) await unlink(testFile);
        if (fs.existsSync(testDir)) {
          const files = await fs.promises.readdir(testDir);
          for (const f of files) await unlink(path.join(testDir, f));
        }
      } catch {
        // ignore
      }
    });

    it("zt should report Scrolled to top", async () => {
      const result = await manager.callTool("vim", {
        commands: [
          ":e test.txt","25G", "zt"],
      });
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Scrolled to top");
    });

    it("zz should report Scrolled to center", async () => {
      const result = await manager.callTool("vim", {
        commands: [
          ":e test.txt","25G", "zz"],
      });
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Scrolled to center");
    });

    it("zb should report Scrolled to bottom", async () => {
      const result = await manager.callTool("vim", {
        commands: [
          ":e test.txt","25G", "zb"],
      });
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Scrolled to bottom");
    });
  });

  describe(":zt, :zz, :zb, :ctrl-f Ex commands", () => {
    let manager: VimToolManager;
    let testDir: string;
    let testFile: string;

    beforeEach(async () => {
      testDir = path.join(__dirname, "temp_scroll_test");
      testFile = path.join(testDir, "scroll.txt");
      if (!fs.existsSync(testDir)) {
        await mkdir(testDir, { recursive: true });
      }
      const content = Array(50)
        .fill(0)
        .map((_, i) => `line ${i + 1}`)
        .join("\n");
      await writeFile(testFile, content + "\n", "utf-8");
      manager = new VimToolManager(testDir);
    });

    afterEach(async () => {
      try {
        if (fs.existsSync(testFile)) await unlink(testFile);
        if (fs.existsSync(testDir)) {
          const files = await fs.promises.readdir(testDir);
          for (const f of files) await unlink(path.join(testDir, f));
        }
      } catch {
        // ignore
      }
    });

    it(":zt should work from command input", async () => {
      const result = await manager.callTool("vim", {
        commands: [
          ":e test.txt",":25", ":zt"],
      });
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Scrolled to top");
    });

    it(":ctrl-f should work from command input", async () => {
      const result = await manager.callTool("vim", {
        commands: [
          ":e test.txt",":ctrl-f"],
      });
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Page down");
    });
  });
});
