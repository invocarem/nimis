// test/vim.dirCommands.test.ts
import { ExCommandHandler } from "../src/utils/vim/commands/ExCommandHandler";
import { VimBuffer, CommandContext, VIM_OPTION_DEFAULTS } from "../src/utils/vim/types";
import { createBuffer } from "../src/utils/vim/models/VimBuffer";
import * as path from "path";

// Mock fs at the module level with proper implementations
// Must include callback-style readFile, writeFile, mkdir for promisify() used by VimBuffer and FileOperations
jest.mock('fs', () => {
  const readFileCb = (path: string, opts: any, callback?: (err: Error | null, data?: Buffer) => void) => {
    const cb = typeof opts === 'function' ? opts : callback!;
    setImmediate(() => cb(null, Buffer.from('')));
  };
  const writeFileCb = (path: string, data: any, opts: any, callback?: (err: Error | null) => void) => {
    const cb = typeof opts === 'function' ? opts : callback!;
    setImmediate(() => cb(null));
  };
  const mkdirCb = (path: string, opts: any, callback?: (err: Error | null) => void) => {
    const cb = typeof opts === 'function' ? opts : callback!;
    setImmediate(() => cb(null));
  };
  return {
    readFile: jest.fn(readFileCb),
    writeFile: jest.fn(writeFileCb),
    mkdir: jest.fn(mkdirCb),
    promises: {
      readFile: jest.fn().mockResolvedValue(''),
      writeFile: jest.fn().mockResolvedValue(undefined),
      unlink: jest.fn().mockResolvedValue(undefined)
    },
    existsSync: jest.fn().mockReturnValue(true),
    statSync: jest.fn().mockReturnValue({ isDirectory: () => true }),
    readFileSync: jest.fn().mockReturnValue(''),
    writeFileSync: jest.fn()
  };
});

// Mock os module
jest.mock('os', () => ({
  homedir: jest.fn().mockReturnValue('/home/testuser')
}));

describe("Vim Directory Commands", () => {
  let handler: ExCommandHandler;
  let mockContext: CommandContext;
  let mockBuffer: VimBuffer;
  let workingDirValue: string;
  let onWorkingDirChange: jest.Mock;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    // Reset working directory
    workingDirValue = "/test";

    // Mock callback
    onWorkingDirChange = jest.fn().mockImplementation((dir: string) => {
      workingDirValue = dir;
    });

    // Simple mock context
    mockContext = {
      buffers: new Map(),
      getCurrentBuffer: jest.fn().mockReturnValue(null),
      setCurrentBuffer: jest.fn(),
      get workingDir() { return workingDirValue; },
      resolvePath: jest.fn().mockImplementation((filePath: string) => {
        if (filePath.startsWith('/')) return filePath;
        if (filePath === '..') return path.dirname(workingDirValue);
        if (filePath === 'src') return path.join(workingDirValue, 'src');
        return path.join(workingDirValue, filePath);
      }),
      options: { ...VIM_OPTION_DEFAULTS },
    };

    // Create test buffer
    mockBuffer = createBuffer(
      "/test/file.txt",
      ["line 1", "line 2", "line 3"],
      '\n'
    );

    handler = new ExCommandHandler(mockContext, onWorkingDirChange);
  });

  test(":pwd returns current working directory", async () => {
    workingDirValue = "/test/project";
    const result = await handler.execute("pwd", mockBuffer);
    expect(result).toBe("/test/project");
  });

  test(":pwd falls back to process.cwd() when workingDir undefined", async () => {
    workingDirValue = undefined as any;
    const result = await handler.execute("pwd", mockBuffer);
    expect(result).toBe(process.cwd());
  });

  test(":cd with no args goes to home directory", async () => {
    const result = await handler.execute("cd", mockBuffer);
    
    expect(onWorkingDirChange).toHaveBeenCalledWith('/home/testuser');
    expect(result).toBe("Changed directory to /home/testuser");
  });

  test(":cd with relative path", async () => {
    workingDirValue = "/test";
    const expectedPath = path.join("/test", "src");
    const result = await handler.execute("cd src", mockBuffer);
    
    expect(mockContext.resolvePath).toHaveBeenCalledWith("src");
    expect(onWorkingDirChange).toHaveBeenCalledWith(expectedPath);
    expect(result).toBe(`Changed directory to ${expectedPath}`);
  });

  test(":cd with absolute path", async () => {
    workingDirValue = "/test";
    (mockContext.resolvePath as jest.Mock).mockReturnValueOnce("/absolute/path");
    
    const result = await handler.execute("cd /absolute/path", mockBuffer);
    
    expect(mockContext.resolvePath).toHaveBeenCalledWith("/absolute/path");
    expect(onWorkingDirChange).toHaveBeenCalledWith("/absolute/path");
    expect(result).toBe("Changed directory to /absolute/path");
  });

  test(":cd with .. goes to parent directory", async () => {
    workingDirValue = "/test/src";
    const result = await handler.execute("cd ..", mockBuffer);
    
    expect(onWorkingDirChange).toHaveBeenCalledWith("/test");
    expect(result).toBe("Changed directory to /test");
  });

  test(":chdir works as alias for cd", async () => {
    workingDirValue = "/test";
    const expectedPath = path.join("/test", "src");
    const result = await handler.execute("chdir src", mockBuffer);
    
    expect(onWorkingDirChange).toHaveBeenCalledWith(expectedPath);
    expect(result).toBe(`Changed directory to ${expectedPath}`);
  });

  test(":cd with non-existent directory throws error", async () => {
    const fs = require('fs');
    fs.existsSync.mockReturnValueOnce(false);
    
    await expect(handler.execute("cd missing", mockBuffer))
      .rejects.toThrow("Directory not found: missing");
    
    expect(onWorkingDirChange).not.toHaveBeenCalled();
  });

  test(":cd to file throws error", async () => {
    const fs = require('fs');
    fs.statSync.mockReturnValueOnce({ isDirectory: () => false });
    
    await expect(handler.execute("cd file.txt", mockBuffer))
      .rejects.toThrow("Directory not found: file.txt");
    
    expect(onWorkingDirChange).not.toHaveBeenCalled();
  });

  test(":cd with quoted path with spaces", async () => {
    workingDirValue = "/test";
    (mockContext.resolvePath as jest.Mock).mockReturnValueOnce("/test/My Project");
    
    const result = await handler.execute("cd 'My Project'", mockBuffer);
    
    expect(mockContext.resolvePath).toHaveBeenCalledWith("My Project");
    expect(onWorkingDirChange).toHaveBeenCalledWith("/test/My Project");
    expect(result).toBe("Changed directory to /test/My Project");
  });

  test(":cd with double-quoted path with spaces", async () => {
    workingDirValue = "/test";
    (mockContext.resolvePath as jest.Mock).mockReturnValueOnce("/test/My Project");
    
    const result = await handler.execute('cd "My Project"', mockBuffer);
    
    expect(mockContext.resolvePath).toHaveBeenCalledWith("My Project");
    expect(onWorkingDirChange).toHaveBeenCalledWith("/test/My Project");
    expect(result).toBe("Changed directory to /test/My Project");
  });

  test(":cd with extra arguments uses first argument only", async () => {
    workingDirValue = "/test";
    (mockContext.resolvePath as jest.Mock).mockReturnValueOnce("/test/dir1");
    
    const result = await handler.execute("cd dir1 dir2 dir3", mockBuffer);
    
    expect(mockContext.resolvePath).toHaveBeenCalledWith("dir1");
    expect(onWorkingDirChange).toHaveBeenCalledWith("/test/dir1");
    expect(result).toBe("Changed directory to /test/dir1");
  });
});