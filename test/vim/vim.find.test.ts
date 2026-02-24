// test/vim/vim.find.test.ts
import { ExCommandHandler } from "../../src/utils/vim/commands/ExCommandHandler";
import { VimBuffer, CommandContext } from "../../src/utils/vim/types";
import { createBuffer } from "../../src/utils/vim/models/VimBuffer";
import * as FileOperations from "../../src/utils/vim/operations/FileOperations";
import * as path from "path";

const mockEditFile = FileOperations.editFile as jest.Mock;

jest.mock("../../src/utils/vim/operations/FileOperations", () => ({
  editFile: jest.fn().mockResolvedValue(undefined),
  writeBuffer: jest.fn().mockResolvedValue(undefined),
  readFileIntoBuffer: jest.fn().mockResolvedValue(""),
  saveAs: jest.fn().mockResolvedValue(""),
  externalCommand: jest.fn().mockResolvedValue(""),
}));

describe("ExCommandHandler - :find / :fin command", () => {
  let handler: ExCommandHandler;
  let ctx: CommandContext;
  let buffer: VimBuffer;

  beforeEach(() => {
    jest.clearAllMocks();
    const workingDir = path.join(path.sep, "test", "proj");
    ctx = {
      buffers: new Map(),
      getCurrentBuffer: jest.fn(),
      setCurrentBuffer: jest.fn(),
      get workingDir() {
        return workingDir;
      },
      resolvePath: (fp: string) =>
        path.isAbsolute(fp) ? fp : path.join(workingDir, fp),
    } as any;
    buffer = createBuffer(path.join(workingDir, "file.txt"), ["line 1"], "\n");
    handler = new ExCommandHandler(ctx);
  });

  describe(":find requires filename", () => {
    it("throws when :find has no argument", async () => {
      await expect(handler.execute("find", buffer)).rejects.toThrow(
        /requires a filename/
      );
    });

    it("throws when :find has only whitespace", async () => {
      await expect(handler.execute("find   ", buffer)).rejects.toThrow(
        /requires a filename/
      );
    });
  });

  describe(":find when path resolves (like :e)", () => {
    it("calls editFile with resolved path when file exists", async () => {
      const statMock = jest.fn().mockResolvedValue({ isFile: () => true });
      const origStat = require("fs").promises.stat;
      require("fs").promises.stat = statMock;
      try {
        const result = await handler.execute("find root.txt", buffer);
        expect(result).toContain("Editing root.txt");
        expect(mockEditFile).toHaveBeenCalledWith("root.txt", ctx);
      } finally {
        require("fs").promises.stat = origStat;
      }
    });
  });

  describe(":fin abbreviation", () => {
    it("accepts :fin as alias for :find", async () => {
      const statMock = jest.fn().mockResolvedValue({ isFile: () => true });
      const origStat = require("fs").promises.stat;
      require("fs").promises.stat = statMock;
      try {
        const result = await handler.execute("fin foo.js", buffer);
        expect(result).toContain("Editing foo.js");
        expect(mockEditFile).toHaveBeenCalledWith("foo.js", ctx);
      } finally {
        require("fs").promises.stat = origStat;
      }
    });
  });

  describe(":find when file not in path", () => {
    it("throws when resolvePath file does not exist and search finds nothing", async () => {
      // stat fails (file not found), then findFileInPath returns null
      const statMock = jest.fn().mockRejectedValue(new Error("ENOENT"));
      const origStat = require("fs").promises.stat;
      require("fs").promises.stat = statMock;
      const readdirMock = jest.fn().mockResolvedValue([]);
      const origReaddir = require("fs").promises.readdir;
      require("fs").promises.readdir = readdirMock;
      try {
        await expect(
          handler.execute("find nonexistent.txt", buffer)
        ).rejects.toThrow(/Can't find file/);
        expect(mockEditFile).not.toHaveBeenCalled();
      } finally {
        require("fs").promises.stat = origStat;
        require("fs").promises.readdir = origReaddir;
      }
    });
  });
});
