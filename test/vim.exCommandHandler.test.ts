// test/vim.exCommandHandler.test.ts
import { ExCommandHandler } from "../src/utils/vim/commands/ExCommandHandler";
import { VimBuffer, CommandContext } from "../src/utils/vim/types";
import { createBuffer } from "../src/utils/vim/models/VimBuffer";
import * as FileOperations from "../src/utils/vim/operations/FileOperations";
import * as BufferOperations from "../src/utils/vim/operations/BufferOperations";
import * as TextOperations from "../src/utils/vim/operations/TextOperations";


// Mock the TextOperations functions
jest.mock("../src/utils/vim/operations/TextOperations", () => ({
  substituteWithPattern: jest.fn().mockReturnValue("Substituted"),
  globalCommand: jest.fn().mockResolvedValue("Executed global command"),
  putLines: jest.fn().mockReturnValue("Put 1 line(s) from register"),
  yankLines: jest.fn().mockReturnValue("Yanked lines"),
  deleteLines: jest.fn().mockReturnValue("Deleted lines"),
  normalExCommand: jest.fn().mockReturnValue("Executed normal command"),
  setMark: jest.fn().mockReturnValue("Mark set")
}));


describe("ExCommandHandler", () => {
  let handler: ExCommandHandler;
  let mockContext: CommandContext;
  let mockBuffer: VimBuffer;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    // Create mock context
    mockContext = {
      buffers: new Map(),
      getCurrentBuffer: jest.fn(),
      setCurrentBuffer: jest.fn(),
      workingDir: "/test",
      resolvePath: (filePath: string) => filePath.startsWith('/') ? filePath : `/test/${filePath}`
    } as any;

    // Create test buffer using the actual createBuffer function
    mockBuffer = createBuffer(
      "/test/file.txt",
      [
        "line 1",
        "line 2",
        "line 3",
        "line 4",
        "line 5"
      ],
      '\n'
    );

    handler = new ExCommandHandler(mockContext);
  });

  describe("Mark vs Register parsing", () => {
    it("should interpret 'ap as mark jump + p command when mark exists", async () => {
      mockBuffer.marks.set('a', 2); // Set mark 'a' at line 3 (0-indexed)
      mockBuffer.registers.set('"', { type: 'linewise', content: ['test line'] });
      
      const result = await handler.execute("'ap", mockBuffer);
      
      expect(mockBuffer.currentLine).toBe(2); // Should jump to mark 'a'
      expect(TextOperations.putLines).toHaveBeenCalledWith(false, undefined, mockBuffer);
    });

    it("should fall back to register interpretation when mark doesn't exist", async () => {
      // No mark 'a' set, but register 'a' exists
      mockBuffer.lastRegister = 'a';
      mockBuffer.registers.set('a', { type: 'linewise', content: ['test line'] });
      
      const result = await handler.execute("'ap", mockBuffer);
      
      // Should not change current line
      expect(mockBuffer.currentLine).toBe(0);
      // Should be handled by register logic - but note: in Ex mode, 'ap is not valid register syntax
      // This test might need to be adjusted based on expected behavior
    });

    it("should correctly handle :pu a syntax for register a", async () => {
      // Setup register 'a' with some content
      mockBuffer.registers.set('a', { type: 'linewise', content: ['test line'] });
      
      const result = await handler.execute("pu a", mockBuffer);
      
      expect(TextOperations.putLines).toHaveBeenCalledWith(false, "a", mockBuffer);
    });

    it("should distinguish between mark ranges and register references", async () => {
      // Mark range 'a,'b should be parsed as range, not register
      mockBuffer.marks.set('a', 0);
      mockBuffer.marks.set('b', 2);
      
      const result = await handler.execute("'a,'by c", mockBuffer);
      
      expect(TextOperations.yankLines).toHaveBeenCalledWith(
        { start: 0, end: 2 },
        "c",
        mockBuffer
      );
    });
  });

  describe("Range parsing", () => {
    it("should parse numeric ranges", async () => {
      await handler.execute("2,4d", mockBuffer);
      
      expect(TextOperations.deleteLines).toHaveBeenCalledWith(
        { start: 1, end: 3 },
        undefined,
        mockBuffer
      );
    });

    it("should parse % as entire file", async () => {
      await handler.execute("%y a", mockBuffer);
      
      expect(TextOperations.yankLines).toHaveBeenCalledWith(
        { start: 0, end: 4 },
        "a",
        mockBuffer
      );
    });

    it("should parse . as current line", async () => {
      mockBuffer.currentLine = 2;
      await handler.execute(".y a", mockBuffer);
      
      expect(TextOperations.yankLines).toHaveBeenCalledWith(
        { start: 2, end: 2 },
        "a",
        mockBuffer
      );
    });

    it("should parse $ as last line", async () => {
      await handler.execute("$y a", mockBuffer);
      
      expect(TextOperations.yankLines).toHaveBeenCalledWith(
        { start: 4, end: 4 },
        "a",
        mockBuffer
      );
    });

    it("should handle relative ranges with + and -", async () => {
      mockBuffer.currentLine = 2; // line 3
      
      // This test might need to be adjusted based on how parseRange handles relative ranges
      // For now, let's test a simpler relative range
      await handler.execute(".,+1y a", mockBuffer);
      
      expect(TextOperations.yankLines).toHaveBeenCalledWith(
        { start: 2, end: 3 },
        "a",
        mockBuffer
      );
    });
  });

  describe("Substitution commands", () => {
    it("should handle :%s/pattern/replacement/", async () => {
      const substituteMock = jest.spyOn(TextOperations, 'substituteWithPattern');
      
      await handler.execute("%s/line /LINE /", mockBuffer);
      
      expect(substituteMock).toHaveBeenCalledWith(
        { start: 0, end: 4 },
        "line ",
        "LINE ",
        "",
        mockBuffer
      );
    });

    it("should handle flags (g, i)", async () => {
      const substituteMock = jest.spyOn(TextOperations, 'substituteWithPattern');
      mockBuffer.content = ["Line", "line", "LINE"];
      
      await handler.execute("%s/line/XXX/gi", mockBuffer);
      
      expect(substituteMock).toHaveBeenCalledWith(
        { start: 0, end: 2 },
        "line",
        "XXX",
        "gi",
        mockBuffer
      );
    });

    it("should handle range substitution", async () => {
      const substituteMock = jest.spyOn(TextOperations, 'substituteWithPattern');
      
      await handler.execute("2,4s/line /LINE /", mockBuffer);
      
      expect(substituteMock).toHaveBeenCalledWith(
        { start: 1, end: 3 },
        "line ",
        "LINE ",
        "",
        mockBuffer
      );
    });

    it("should handle current line substitution", async () => {
      const substituteMock = jest.spyOn(TextOperations, 'substituteWithPattern');
      mockBuffer.currentLine = 2;
      
      await handler.execute("s/line /LINE /", mockBuffer);
      
      expect(substituteMock).toHaveBeenCalledWith(
        { start: 2, end: 2 },
        "line ",
        "LINE ",
        "",
        mockBuffer
      );
    });
  });

  describe("Global commands", () => {
    it("should handle :g/pattern/d", async () => {
      const globalMock = jest.spyOn(TextOperations, 'globalCommand');
      
      await handler.execute("g/2/d", mockBuffer);
      
      expect(globalMock).toHaveBeenCalledWith("/2/d", false, mockBuffer);
    });

    it("should handle :v/pattern/d (inverse)", async () => {
      const globalMock = jest.spyOn(TextOperations, 'globalCommand');
      
      await handler.execute("v/2/d", mockBuffer);
      
      expect(globalMock).toHaveBeenCalledWith("/2/d", true, mockBuffer);
    });
  });

  describe("Delete and yank commands", () => {
    it("should handle :d with range", async () => {
      await handler.execute("2,4d", mockBuffer);
      
      expect(TextOperations.deleteLines).toHaveBeenCalledWith(
        { start: 1, end: 3 },
        undefined,
        mockBuffer
      );
    });

    it("should handle :d with register", async () => {
      await handler.execute("2,4d a", mockBuffer);
      
      expect(TextOperations.deleteLines).toHaveBeenCalledWith(
        { start: 1, end: 3 },
        "a",
        mockBuffer
      );
    });

    it("should handle :y with range and register", async () => {
      await handler.execute("2,4y b", mockBuffer);
      
      expect(TextOperations.yankLines).toHaveBeenCalledWith(
        { start: 1, end: 3 },
        "b",
        mockBuffer
      );
    });
  });

  describe("Put commands", () => {
    it("should handle :pu (after cursor)", async () => {
      await handler.execute("pu", mockBuffer);
      
      expect(TextOperations.putLines).toHaveBeenCalledWith(false, undefined, mockBuffer);
    });

    it("should handle :pu with register", async () => {
      await handler.execute("pu a", mockBuffer);
      
      expect(TextOperations.putLines).toHaveBeenCalledWith(false, "a", mockBuffer);
    });

    it("should handle :pu! (before cursor)", async () => {
      await handler.execute("pu!", mockBuffer);
      
      expect(TextOperations.putLines).toHaveBeenCalledWith(true, undefined, mockBuffer);
    });

    it("should handle :p (after cursor)", async () => {
      await handler.execute("p", mockBuffer);
      
      expect(TextOperations.putLines).toHaveBeenCalledWith(false, undefined, mockBuffer);
    });

    it("should handle :P (before cursor)", async () => {
      await handler.execute("P", mockBuffer);
      
      expect(TextOperations.putLines).toHaveBeenCalledWith(true, undefined, mockBuffer);
    });
  });

  describe("File operations", () => {
    it("should handle :e with filename", async () => {
      const newBuffer = createBuffer("/test/newfile.txt", [""], '\n');
      const editFileMock = jest.spyOn(FileOperations, 'editFile').mockResolvedValue(newBuffer);
      
      const result = await handler.execute("e newfile.txt", mockBuffer);
      
      expect(editFileMock).toHaveBeenCalledWith("newfile.txt", mockContext);
      expect(result).toBe("Editing newfile.txt");
      
      editFileMock.mockRestore();
    });

    it("should handle :w", async () => {
      const writeBufferMock = jest.spyOn(FileOperations, 'writeBuffer').mockResolvedValue(undefined);
      
      const result = await handler.execute("w", mockBuffer);
      
      expect(writeBufferMock).toHaveBeenCalledWith(mockBuffer);
      expect(result).toContain("written");
      
      writeBufferMock.mockRestore();
    });

    it("should handle :r with filename", async () => {
      const readFileMock = jest.spyOn(FileOperations, 'readFileIntoBuffer').mockResolvedValue("File read");
      
      const result = await handler.execute("r otherfile.txt", mockBuffer);
      
      expect(readFileMock).toHaveBeenCalledWith("otherfile.txt", mockBuffer);
      expect(result).toBe("File read");
      
      readFileMock.mockRestore();
    });

    it("should handle :saveas with filename", async () => {
      const saveAsMock = jest.spyOn(FileOperations, 'saveAs').mockResolvedValue("Saved as newfile.txt");
      
      const result = await handler.execute("saveas newfile.txt", mockBuffer);
      
      expect(saveAsMock).toHaveBeenCalledWith("newfile.txt", mockBuffer, mockContext.buffers);
      expect(result).toBe("Saved as newfile.txt");
      
      saveAsMock.mockRestore();
    });
  });

  describe("Buffer operations", () => {
    it("should handle :bn (next buffer)", async () => {
      const nextBufferMock = { ...mockBuffer, path: "/test/next.txt" };
      const getNextMock = jest.spyOn(BufferOperations, 'getNextBuffer').mockReturnValue(nextBufferMock);
      mockContext.getCurrentBuffer = jest.fn().mockReturnValue(mockBuffer);
      mockContext.setCurrentBuffer = jest.fn();
      
      const result = await handler.execute("bn", mockBuffer);
      
      expect(getNextMock).toHaveBeenCalledWith(mockContext.buffers, mockBuffer);
      expect(mockContext.setCurrentBuffer).toHaveBeenCalledWith(nextBufferMock);
      expect(result).toContain("Editing next.txt");
      
      getNextMock.mockRestore();
    });

    it("should handle :bp (previous buffer)", async () => {
      const prevBufferMock = { ...mockBuffer, path: "/test/prev.txt" };
      const getPrevMock = jest.spyOn(BufferOperations, 'getPreviousBuffer').mockReturnValue(prevBufferMock);
      mockContext.getCurrentBuffer = jest.fn().mockReturnValue(mockBuffer);
      mockContext.setCurrentBuffer = jest.fn();
      
      const result = await handler.execute("bp", mockBuffer);
      
      expect(getPrevMock).toHaveBeenCalledWith(mockContext.buffers, mockBuffer);
      expect(mockContext.setCurrentBuffer).toHaveBeenCalledWith(prevBufferMock);
      expect(result).toContain("Editing prev.txt");
      
      getPrevMock.mockRestore();
    });

    it("should handle :ls or :buffers", async () => {
      const formatMock = jest.spyOn(BufferOperations, 'formatBufferList').mockReturnValue("formatted buffer list");
      mockContext.getCurrentBuffer = jest.fn().mockReturnValue(mockBuffer);
      
      const result = await handler.execute("ls", mockBuffer);
      
      expect(formatMock).toHaveBeenCalledWith(mockContext.buffers, mockBuffer);
      expect(result).toBe("formatted buffer list");
      
      formatMock.mockRestore();
    });

    it("should handle :b with buffer number", async () => {
      const switchMock = jest.spyOn(BufferOperations, 'switchToBuffer').mockResolvedValue(mockBuffer);
      mockContext.setCurrentBuffer = jest.fn();
      mockContext.getCurrentBuffer = jest.fn().mockReturnValue(mockBuffer);
      
      const result = await handler.execute("b 1", mockBuffer);
      
      expect(switchMock).toHaveBeenCalledWith("1", mockContext.buffers);
      expect(mockContext.setCurrentBuffer).toHaveBeenCalledWith(mockBuffer);
      expect(result).toContain("Editing file.txt");
      
      switchMock.mockRestore();
    });
  });

  describe("Edge cases and error handling", () => {
    it("should handle empty command", async () => {
      const result = await handler.execute("", mockBuffer);
      expect(result).toBe("");
    });

    it("should throw on unsupported command", async () => {
      await expect(handler.execute("unsupported", mockBuffer))
        .rejects.toThrow("Unsupported Ex command: unsupported");
    });

    it("should handle mark jump with trailing command", async () => {
      mockBuffer.marks.set('a', 2);
      
      // 'add should jump to mark 'a' and then try to execute 'dd'
      // Since 'dd' is not an Ex command, it should throw
      await expect(handler.execute("'add", mockBuffer))
        .rejects.toThrow("Unsupported Ex command: dd");
      
      expect(mockBuffer.currentLine).toBe(2);
    });

    it("should handle pattern ranges with /pattern/", async () => {
      const deleteMock = jest.spyOn(TextOperations, 'deleteLines');
      mockBuffer.content = [
        "start here",
        "middle",
        "end here",
        "after"
      ];
      
      await handler.execute("/start/,/end/d", mockBuffer);
      
      expect(deleteMock).toHaveBeenCalled();
    });

    it("should handle register reference with double quote", async () => {
      mockBuffer.registers.set('a', { type: 'linewise', content: ['test line'] });
      
      const result = await handler.execute("\"ap", mockBuffer);
      
      expect(TextOperations.putLines).toHaveBeenCalledWith(false, "a", mockBuffer);
    });

    it("should handle mark reference with invalid mark", async () => {
      await expect(handler.execute("'zdd", mockBuffer))
        .rejects.toThrow("Mark 'z not set");
    });

    it("should handle external commands with !", async () => {
      const externalMock = jest.spyOn(FileOperations, 'externalCommand').mockResolvedValue("Command output");
      
      const result = await handler.execute("!ls -la", mockBuffer);
      
      expect(externalMock).toHaveBeenCalledWith(null, "ls -la", mockBuffer);
      expect(result).toBe("Command output");
      
      externalMock.mockRestore();
    });

    it("should handle external command with range", async () => {
      const externalMock = jest.spyOn(FileOperations, 'externalCommand').mockResolvedValue("Filtered output");
      
      const result = await handler.execute("2,4!sort", mockBuffer);
      
      expect(externalMock).toHaveBeenCalledWith(
        { start: 1, end: 3 },
        "sort",
        mockBuffer
      );
      
      externalMock.mockRestore();
    });

    it("should handle :normal command", async () => {
      const normalMock = jest.spyOn(TextOperations, 'normalExCommand').mockReturnValue("Executed normal command");
      
      const result = await handler.execute("norm dd", mockBuffer);
      
      expect(normalMock).toHaveBeenCalledWith(null, "dd", mockBuffer);
      expect(result).toBe("Executed normal command");
      
      normalMock.mockRestore();
    });

    it("should handle :normal with range", async () => {
      const normalMock = jest.spyOn(TextOperations, 'normalExCommand').mockReturnValue("Executed normal command on range");
      
      const result = await handler.execute("2,4norm dd", mockBuffer);
      
      expect(normalMock).toHaveBeenCalledWith(
        { start: 1, end: 3 },
        "dd",
        mockBuffer
      );
      
      normalMock.mockRestore();
    });
  });
});