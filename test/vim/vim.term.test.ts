// Mock vscode for terminal command tests
const mockShow = jest.fn();
const mockSendText = jest.fn();
jest.mock("vscode", () => ({
  window: {
    createTerminal: jest.fn((options?: { cwd?: string; name?: string }) => ({
      show: mockShow,
      sendText: mockSendText,
    })),
  },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: process.cwd() } }],
    getConfiguration: jest.fn(() => ({
      get: jest.fn((key: string, defaultValue: unknown) => defaultValue),
    })),
  },
}));

import { VimToolManager } from "../../src/utils/vim";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);
const mkdir = promisify(fs.mkdir);

describe("VimToolManager - :terminal command", () => {
  let manager: VimToolManager;
  let testDir: string;
  let testFile: string;

  beforeEach(async () => {
    mockShow.mockClear();
    mockSendText.mockClear();

    testDir = path.join(__dirname, "temp_term_test");
    testFile = path.join(testDir, "foo.txt");

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

  describe(":terminal", () => {
    it("should open a terminal with no command", async () => {
      await writeFile(testFile, "hello\n", "utf-8");

      const result = await manager.callTool("vim", {
      commands: [":e foo.txt", ":terminal"],
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Opened terminal");
      expect(mockShow).toHaveBeenCalled();
      expect(mockSendText).not.toHaveBeenCalled();
    });

    it("should open a terminal and run command when args provided", async () => {
      await writeFile(testFile, "hello\n", "utf-8");

      const result = await manager.callTool("vim", {
      commands: [":e foo.txt", ":terminal npm run dev"],
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Opened terminal");
      expect(result.content[0].text).toContain("npm run dev");
      expect(mockShow).toHaveBeenCalled();
      expect(mockSendText).toHaveBeenCalledWith("npm run dev");
    });

    it("should use working directory from :cd", async () => {
      await writeFile(testFile, "hello\n", "utf-8");
      const subDir = path.join(testDir, "subdir");
      await mkdir(subDir, { recursive: true });

      await manager.callTool("vim", {
      commands: [":e foo.txt", ":cd subdir", ":terminal pwd"],
      });

      expect(mockSendText).toHaveBeenCalledWith("pwd");
      const vscode = require("vscode");
      expect(vscode.window.createTerminal).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: subDir,
          name: "Vim :terminal",
        })
      );
    });
  });

  describe(":termal alias", () => {
    it("should work as alias for :terminal", async () => {
      await writeFile(testFile, "hello\n", "utf-8");

      const result = await manager.callTool("vim", {
      commands: [":e foo.txt", ":termal"],
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Opened terminal");
      expect(mockShow).toHaveBeenCalled();
    });

    it("should accept command args like :terminal", async () => {
      await writeFile(testFile, "hello\n", "utf-8");

      const result = await manager.callTool("vim", {
      commands: [":e foo.txt", ":termal echo hello"],
      });

      expect(result.isError).toBeFalsy();
      expect(mockSendText).toHaveBeenCalledWith("echo hello");
    });
  });

  describe(":term abbreviation", () => {
    it("should work with :term abbreviation", async () => {
      await writeFile(testFile, "hello\n", "utf-8");

      const result = await manager.callTool("vim", {
      commands: [":term"],
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Opened terminal");
      expect(mockShow).toHaveBeenCalled();
    });
  });

  describe("help", () => {
    it("should show help for :help terminal", async () => {
      await writeFile(testFile, "hello\n", "utf-8");

      const result = await manager.callTool("vim", {
      commands: [":e foo.txt", ":help terminal"],
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain(":ter[minal]");
      expect(result.content[0].text).toContain("VS Code terminal");
    });

    it("should show help for :help termal", async () => {
      await writeFile(testFile, "hello\n", "utf-8");

      const result = await manager.callTool("vim", {
      commands: [":e foo.txt", ":help termal"],
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Alias for :terminal");
    });
  });
});
