// test/vim.stateMachine.test.ts
import { VimStateMachine } from "../src/utils/vim/commands/VimStateMachine";
import { VimBuffer, CommandContext } from "../src/utils/vim/types";
import { createBuffer } from "../src/utils/vim/models/VimBuffer";
import { ExCommandHandler } from "../src/utils/vim/commands/ExCommandHandler";
import * as FileOperations from "../src/utils/vim/operations/FileOperations";

// Mock the ExCommandHandler
jest.mock("../src/utils/vim/commands/ExCommandHandler", () => {
  return {
    ExCommandHandler: jest.fn().mockImplementation(() => ({
      execute: jest.fn().mockImplementation(async (cmd, buffer) => {
        if (cmd === 'w') {
          return 'File written';
        }
        if (cmd === 'q') {
          return 'Buffer closed';
        }
        if (cmd === 'e test.txt') {
          return 'Editing test.txt';
        }
        return `Executed: ${cmd}`;
      })
    }))
  };
});

describe("VimStateMachine", () => {
  let stateMachine: VimStateMachine;
  let mockBuffer: VimBuffer;
  let mockContext: CommandContext;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    // Create mock context
    mockContext = {
      buffers: new Map(),
      getCurrentBuffer: jest.fn(),
      setCurrentBuffer: jest.fn(),
      resolvePath: (filePath: string) => filePath
    } as any;

    // Create test buffer
    mockBuffer = createBuffer(
      "/test/file.txt",
      [
        "line one",
        "line two",
        "line three",
        "line four",
        "line five"
      ],
      '\n'
    );

    stateMachine = new VimStateMachine(mockContext);
    stateMachine.setBuffer(mockBuffer);
  });

  describe("Initial state", () => {
    it("should start in normal mode", () => {
      const state = stateMachine.getState();
      expect(state.mode).toBe('normal');
      expect(state.buffer).toBe(mockBuffer);
      expect(state.cursorPosition).toEqual({ line: 0, column: 0 });
      expect(state.commandBuffer).toBe('');
      expect(state.pendingCommand).toBeUndefined();
    });
  });

  describe("Normal mode - Mode switching", () => {
    it("should switch to insert mode on 'i'", async () => {
      const result = await stateMachine.processKey('i');
      
      expect(result.stateChanged).toBe(true);
      expect(result.output).toBe("-- INSERT --");
      expect(stateMachine.getState().mode).toBe('insert');
    });

    it("should switch to insert mode on 'a' and move cursor right", async () => {
      const result = await stateMachine.processKey('a');
      
      expect(result.stateChanged).toBe(true);
      expect(result.output).toBe("-- INSERT --");
      expect(stateMachine.getState().mode).toBe('insert');
      expect(stateMachine.getState().cursorPosition.column).toBe(1);
    });

    it("should switch to insert mode on 'A' at end of line", async () => {
      const result = await stateMachine.processKey('A');
      
      expect(result.stateChanged).toBe(true);
      expect(result.output).toBe("-- INSERT --");
      expect(stateMachine.getState().mode).toBe('insert');
      expect(stateMachine.getState().cursorPosition.column).toBe(mockBuffer.content[0].length);
    });

    it("should switch to insert mode on 'I' at beginning of line", async () => {
      // First move cursor somewhere in the middle
      stateMachine.getState().cursorPosition.column = 5;
      
      const result = await stateMachine.processKey('I');
      
      expect(result.stateChanged).toBe(true);
      expect(result.output).toBe("-- INSERT --");
      expect(stateMachine.getState().mode).toBe('insert');
      expect(stateMachine.getState().cursorPosition.column).toBe(0);
    });

    it("should open line below with 'o' and enter insert mode", async () => {
      const originalLength = mockBuffer.content.length;
      const result = await stateMachine.processKey('o');
      
      expect(result.stateChanged).toBe(true);
      expect(result.output).toBe("-- INSERT --");
      expect(stateMachine.getState().mode).toBe('insert');
      expect(mockBuffer.content.length).toBe(originalLength + 1);
      expect(mockBuffer.currentLine).toBe(1); // Original line 0 + 1
      expect(stateMachine.getState().cursorPosition.line).toBe(1);
      expect(stateMachine.getState().cursorPosition.column).toBe(0);
      expect(mockBuffer.modified).toBe(true);
    });

    it("should open line above with 'O' and enter insert mode", async () => {
      mockBuffer.currentLine = 2; // Move to line 3
      stateMachine.getState().cursorPosition.line = 2;
      
      const originalLength = mockBuffer.content.length;
      const result = await stateMachine.processKey('O');
      
      expect(result.stateChanged).toBe(true);
      expect(result.output).toBe("-- INSERT --");
      expect(stateMachine.getState().mode).toBe('insert');
      expect(mockBuffer.content.length).toBe(originalLength + 1);
      expect(mockBuffer.currentLine).toBe(2); // Should stay at line 3 (new line inserted above)
      expect(stateMachine.getState().cursorPosition.line).toBe(2);
      expect(stateMachine.getState().cursorPosition.column).toBe(0);
      expect(mockBuffer.modified).toBe(true);
    });

    it("should switch to command-line mode on ':'", async () => {
      const result = await stateMachine.processKey(':');
      
      expect(result.stateChanged).toBe(true);
      expect(result.output).toBe(":");
      expect(stateMachine.getState().mode).toBe('command-line');
      expect(stateMachine.getState().commandBuffer).toBe(':');
    });
  });

  describe("Normal mode - Command execution", () => {
    it("should execute single-key commands", async () => {
      // Mock the normal handler execute method
      const result = await stateMachine.processKey('j');
      
      expect(result.stateChanged).toBe(false);
      expect(mockBuffer.currentLine).toBe(1); // Moved down one line
    });

    it("should handle numeric prefixes", async () => {
      let result = await stateMachine.processKey('3');
      expect(result.output).toBe("(pending: 3)");
      expect(stateMachine.getState().pendingCommand).toBe('3');
      
      result = await stateMachine.processKey('j');
      expect(mockBuffer.currentLine).toBe(3); // Moved down 3 lines
      expect(stateMachine.getState().pendingCommand).toBeUndefined();
    });

    it("should handle multi-key commands like 'dd'", async () => {
      const originalLength = mockBuffer.content.length;
      
      let result = await stateMachine.processKey('d');
      expect(stateMachine.getState().pendingCommand).toBe('d');
      
      result = await stateMachine.processKey('d');
      expect(mockBuffer.content.length).toBe(originalLength - 1);
      expect(stateMachine.getState().pendingCommand).toBeUndefined();
    });

    it("should handle 'gg' to go to top", async () => {
      mockBuffer.currentLine = 4;
      stateMachine.getState().cursorPosition.line = 4;
      
      await stateMachine.processKey('g');
      const result = await stateMachine.processKey('g');
      
      expect(mockBuffer.currentLine).toBe(0);
      expect(stateMachine.getState().cursorPosition.line).toBe(0);
    });

    it("should handle 'G' to go to bottom", async () => {
      await stateMachine.processKey('G');
      
      expect(mockBuffer.currentLine).toBe(mockBuffer.content.length - 1);
    });

    it("should handle '0' to go to beginning of line", async () => {
      stateMachine.getState().cursorPosition.column = 5;
      
      await stateMachine.processKey('0');
      
      expect(stateMachine.getState().cursorPosition.column).toBe(0);
    });

    it("should handle '$' to go to end of line", async () => {
      await stateMachine.processKey('$');
      
      expect(stateMachine.getState().cursorPosition.column).toBe(mockBuffer.content[0].length);
    });
  });

  describe("Insert mode", () => {
    beforeEach(async () => {
      await stateMachine.processKey('i');
    });

    it("should insert characters at cursor position", async () => {
      stateMachine.getState().cursorPosition.column = 4; // Before ' ' in "line one"
      
      await stateMachine.processKey('X');
      await stateMachine.processKey('Y');
      await stateMachine.processKey('Z');
      
      expect(mockBuffer.content[0]).toBe("lineXYZ one");
      expect(stateMachine.getState().cursorPosition.column).toBe(7);
      expect(mockBuffer.modified).toBe(true);
    });

    it("should handle Enter key to split line", async () => {
      stateMachine.getState().cursorPosition.column = 4; // After "line"
      
      await stateMachine.processKey('\n');
      
      expect(mockBuffer.content[0]).toBe("line");
      expect(mockBuffer.content[1]).toBe(" one");
      expect(stateMachine.getState().cursorPosition.line).toBe(1);
      expect(stateMachine.getState().cursorPosition.column).toBe(0);
    });

    it("should handle Backspace at middle of line", async () => {
      stateMachine.getState().cursorPosition.column = 5; // After "line "
      
      await stateMachine.processKey('\b');
      
      expect(mockBuffer.content[0]).toBe("lineone"); // Space removed
      expect(stateMachine.getState().cursorPosition.column).toBe(4);
    });

    it("should handle Backspace at beginning of line to join with previous", async () => {
      mockBuffer.currentLine = 1;
      stateMachine.getState().cursorPosition.line = 1;
      stateMachine.getState().cursorPosition.column = 0;
      
      const prevLineContent = mockBuffer.content[0];
      
      await stateMachine.processKey('\b');
      
      expect(mockBuffer.content.length).toBe(4); // One line removed
      expect(mockBuffer.content[0]).toBe(prevLineContent + "line two"); // Lines joined
      expect(stateMachine.getState().cursorPosition.line).toBe(0);
      expect(stateMachine.getState().cursorPosition.column).toBe(prevLineContent.length);
    });

    it("should handle Tab key", async () => {
      stateMachine.getState().cursorPosition.column = 4; // Before ' ' in "line one"
      
      await stateMachine.processKey('\t');
      
      expect(mockBuffer.content[0]).toBe("line   one"); // Two spaces inserted before existing space
      expect(stateMachine.getState().cursorPosition.column).toBe(6);
    });

    it("should return to normal mode on Escape", async () => {
      const result = await stateMachine.processKey('\x1b');
      
      expect(result.stateChanged).toBe(true);
      expect(result.output).toBe("-- NORMAL --");
      expect(stateMachine.getState().mode).toBe('normal');
      // Cursor should move left one position
      expect(stateMachine.getState().cursorPosition.column).toBe(0); // Was at 0, stays at 0
    });
  });

  describe("Command-line mode", () => {
    beforeEach(async () => {
      await stateMachine.processKey(':');
    });

    it("should build command buffer as characters are typed", async () => {
      await stateMachine.processKey('w');
      expect(stateMachine.getState().commandBuffer).toBe(':w');
      
      await stateMachine.processKey('q');
      expect(stateMachine.getState().commandBuffer).toBe(':wq');
    });

    it("should handle Backspace in command buffer", async () => {
      await stateMachine.processKey('w');
      await stateMachine.processKey('r');
      await stateMachine.processKey('i');
      expect(stateMachine.getState().commandBuffer).toBe(':wri');
      
      await stateMachine.processKey('\b');
      expect(stateMachine.getState().commandBuffer).toBe(':wr');
      
      await stateMachine.processKey('\b');
      expect(stateMachine.getState().commandBuffer).toBe(':w');
    });

    it("should execute command on Enter", async () => {
      await stateMachine.processKey('w');
      
      const result = await stateMachine.processKey('\n');
      
      expect(result.stateChanged).toBe(true);
      expect(result.output).toBe("File written");
      expect(stateMachine.getState().mode).toBe('normal');
      expect(stateMachine.getState().commandBuffer).toBe('');
    });

    it("should cancel command-line mode on Escape", async () => {
      await stateMachine.processKey('w');
      
      const result = await stateMachine.processKey('\x1b');
      
      expect(result.stateChanged).toBe(true);
      expect(result.output).toBe("-- CANCELLED --");
      expect(stateMachine.getState().mode).toBe('normal');
      expect(stateMachine.getState().commandBuffer).toBe('');
    });

    it("should handle empty command", async () => {
      const result = await stateMachine.processKey('\n');
      
      expect(result.stateChanged).toBe(true);
      expect(result.output).toBe("");
      expect(stateMachine.getState().mode).toBe('normal');
    });

    it("should handle complex commands with arguments", async () => {
      const command = "e test.txt";
      for (const char of command) {
        await stateMachine.processKey(char);
      }
      
      const result = await stateMachine.processKey('\n');
      
      expect(result.output).toBe("Editing test.txt");
    });
  });

  describe("Cursor movement", () => {
    it("should move cursor left with h", async () => {
      stateMachine.getState().cursorPosition.column = 5;
      
      await stateMachine.processKey('h');
      
      expect(stateMachine.getState().cursorPosition.column).toBe(4);
    });

    it("should move cursor right with l", async () => {
      stateMachine.getState().cursorPosition.column = 5;
      
      await stateMachine.processKey('l');
      
      expect(stateMachine.getState().cursorPosition.column).toBe(6);
    });

    it("should move cursor down with j", async () => {
      stateMachine.getState().cursorPosition.line = 2;
      
      await stateMachine.processKey('j');
      
      expect(stateMachine.getState().cursorPosition.line).toBe(3);
    });

    it("should move cursor up with k", async () => {
      stateMachine.getState().cursorPosition.line = 2;
      
      await stateMachine.processKey('k');
      
      expect(stateMachine.getState().cursorPosition.line).toBe(1);
    });

    it("should not move cursor beyond buffer boundaries", async () => {
      // Try to move left at beginning of line
      stateMachine.getState().cursorPosition.column = 0;
      await stateMachine.processKey('h');
      expect(stateMachine.getState().cursorPosition.column).toBe(0);
      
      // Try to move up at first line
      stateMachine.getState().cursorPosition.line = 0;
      await stateMachine.processKey('k');
      expect(stateMachine.getState().cursorPosition.line).toBe(0);
      
      // Try to move right at end of line
      stateMachine.getState().cursorPosition.column = mockBuffer.content[0].length;
      await stateMachine.processKey('l');
      expect(stateMachine.getState().cursorPosition.column).toBe(mockBuffer.content[0].length);
      
      // Try to move down at last line
      stateMachine.getState().cursorPosition.line = mockBuffer.content.length - 1;
      await stateMachine.processKey('j');
      expect(stateMachine.getState().cursorPosition.line).toBe(mockBuffer.content.length - 1);
    });
  });

  describe("Error handling", () => {
    it("should handle invalid commands", async () => {
      const result = await stateMachine.processKey('Z'); // 'Z' is not implemented
      
      expect(result.output).toContain("Error");
      expect(result.stateChanged).toBe(false);
    });

    it("should handle errors in command-line mode", async () => {
      await stateMachine.processKey(':');
      
      // Mock the exHandler.execute to throw an error
      const exHandler = (stateMachine as any).exHandler;
      exHandler.execute.mockRejectedValueOnce(new Error("Command failed"));
      
      await stateMachine.processKey('w');
      const result = await stateMachine.processKey('\n');
      
      expect(result.output).toContain("Error: Error: Command failed");
      expect(result.stateChanged).toBe(true);
      expect(stateMachine.getState().mode).toBe('normal');
    });

    it("should handle no active buffer", async () => {
      stateMachine.setBuffer(null as any); // Force no buffer
      
      const result = await stateMachine.processKey('i');
      
      expect(result.output).toBe("No buffer active");
      expect(result.stateChanged).toBe(false);
    });
  });

  describe("Complex scenarios", () => {
    it("should handle multiple mode switches and commands", async () => {
      // Start in normal mode, insert text, return to normal, save
      await stateMachine.processKey('i');
      await stateMachine.processKey('H');
      await stateMachine.processKey('e');
      await stateMachine.processKey('l');
      await stateMachine.processKey('l');
      await stateMachine.processKey('o');
      await stateMachine.processKey('\x1b');
      
      expect(mockBuffer.content[0]).toBe("Helloline one");
      
      await stateMachine.processKey(':');
      await stateMachine.processKey('w');
      const result = await stateMachine.processKey('\n');
      
      expect(result.output).toBe("File written");
    });

    it("should handle numeric prefixes with operations", async () => {
      await stateMachine.processKey('2');
      await stateMachine.processKey('d');
      await stateMachine.processKey('d');
      
      expect(mockBuffer.content.length).toBe(3); // Started with 5, deleted 2
      expect(mockBuffer.content[0]).toBe("line three");
    });

    it("should preserve state across multiple operations", async () => {
      // Move down 2 lines
      await stateMachine.processKey('2');
      await stateMachine.processKey('j');
      expect(mockBuffer.currentLine).toBe(2);
      
      // Insert text
      await stateMachine.processKey('i');
      await stateMachine.processKey('X');
      await stateMachine.processKey('Y');
      await stateMachine.processKey('Z');
      await stateMachine.processKey('\x1b');
      
      expect(mockBuffer.content[2]).toBe("XYZline three");
      
      // Delete line
      await stateMachine.processKey('d');
      await stateMachine.processKey('d');
      
      expect(mockBuffer.content.length).toBe(4);
      expect(mockBuffer.content[2]).toBe("line four");
    });
  });

  describe("setBuffer", () => {
    it("should update buffer and adjust cursor position", () => {
      const newBuffer = createBuffer("/test/new.txt", ["new line 1", "new line 2"], '\n');
      
      stateMachine.setBuffer(newBuffer);
      
      const state = stateMachine.getState();
      expect(state.buffer).toBe(newBuffer);
      expect(state.cursorPosition.line).toBe(0);
      expect(state.cursorPosition.column).toBe(0);
    });

    it("should clamp cursor position to buffer bounds", () => {
      const state = stateMachine.getState();
      state.cursorPosition.line = 100; // Out of bounds
      state.cursorPosition.column = 100; // Out of bounds
      
      stateMachine.setBuffer(mockBuffer);
      
      expect(state.cursorPosition.line).toBe(mockBuffer.content.length - 1);
      expect(state.cursorPosition.column).toBe(mockBuffer.content[mockBuffer.content.length - 1].length);
    });
  });
});
