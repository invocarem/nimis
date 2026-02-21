// test/vim.quitCommands.test.ts
import { VimToolManager } from "../src/utils/vim";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);
const mkdir = promisify(fs.mkdir);

describe("VimToolManager - Quit Commands", () => {
  let manager: VimToolManager;
  let testDir: string;
  let testFile: string;

  beforeEach(async () => {
    testDir = path.join(__dirname, "temp_quit_test");
    testFile = path.join(testDir, "test.txt");
    
    if (!fs.existsSync(testDir)) {
      await mkdir(testDir, { recursive: true });
    }

    manager = new VimToolManager(testDir);
    
    const content = "line 1\nline 2\nline 3\n";
    await writeFile(testFile, content, "utf-8");
  });

  afterEach(async () => {
    try {
      if (fs.existsSync(testFile)) {
        await unlink(testFile);
      }
    } catch (e) {
      // Ignore
    }
  });

  it("should handle quit with unsaved changes", async () => {
    await manager.callTool("vim_edit", {
      file_path: testFile,
      commands: [
        "i# New content",
        ":q"
      ]
    });

    // Buffer should still be open with modified indicator
    const listResult = await manager.callTool("vim_buffer_list", {});
    expect(listResult.content[0].text).toContain("+");
  });

  it("should force quit with :q!", async () => {
    await manager.callTool("vim_edit", {
      file_path: testFile,
      commands: [
        "i# New content",
        ":q!"
      ]
    });

    const listResult = await manager.callTool("vim_buffer_list", {});
    expect(listResult.content[0].text).toBe("No buffers open");
    
    // File should remain unchanged
    const content = await readFile(testFile, "utf-8");
    expect(content).toBe("line 1\nline 2\nline 3\n");
  });

  it("should write and quit with :wq", async () => {
    await manager.callTool("vim_edit", {
      file_path: testFile,
      commands: [
        "i# New content",
        ":wq"
      ]
    });

    const listResult = await manager.callTool("vim_buffer_list", {});
    expect(listResult.content[0].text).toBe("No buffers open");
    
    // File should be updated
    const content = await readFile(testFile, "utf-8");
    expect(content).toContain("# New content");
  });
});
