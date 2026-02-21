// test/registers.test.ts
import { VimToolManager } from "../src/utils/vim";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);
const mkdir = promisify(fs.mkdir);

describe("Register Operations", () => {
  let manager: VimToolManager;
  let testDir: string;
  let testFile: string;

  beforeEach(async () => {
    testDir = path.join(__dirname, "temp_reg_test");
    testFile = path.join(testDir, "test.txt");
    
    if (!fs.existsSync(testDir)) {
      await mkdir(testDir, { recursive: true });
    }

    manager = new VimToolManager(testDir);
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

  it("should initialize all registers", async () => {
    await writeFile(testFile, "test\n", "utf-8");
    
    // Show registers should work even with no operations
    const result = await manager.callTool("vim_show_registers", {});
    expect(result.isError).toBeFalsy();
  });

  it("should store yanked lines in named register", async () => {
    const content = "line1\nline2\nline3\n";
    await writeFile(testFile, content, "utf-8");

    await manager.callTool("vim_edit", {
      file_path: testFile,
      commands: ["2G", '"ayy']  // Yank line 2 to register a
    });

    const registers = await manager.callTool("vim_show_registers", {});
    expect(registers.content[0].text).toContain('"a');
    expect(registers.content[0].text).toContain('line2');
  });

  it("should store deleted lines in named register", async () => {
    const content = "line1\nline2\nline3\n";
    await writeFile(testFile, content, "utf-8");

    await manager.callTool("vim_edit", {
      file_path: testFile,
      commands: ["2G", '"add']  // Delete line 2 to register a
    });

    const registers = await manager.callTool("vim_show_registers", {});
    expect(registers.content[0].text).toContain('"a');
    expect(registers.content[0].text).toContain('line2');
  });

  it("should update unnamed register on yank", async () => {
    const content = "line1\nline2\n";
    await writeFile(testFile, content, "utf-8");

    await manager.callTool("vim_edit", {
      file_path: testFile,
      commands: ["yy"]  // Yank to unnamed register
    });

    const registers = await manager.callTool("vim_show_registers", {});
    expect(registers.content[0].text).toContain('"   line1');
  });

  it("should update numbered registers on delete", async () => {
    const content = "line1\nline2\nline3\nline4\n";
    await writeFile(testFile, content, "utf-8");

    // Delete multiple lines to test numbered registers
    await manager.callTool("vim_edit", {
      file_path: testFile,
      commands: ["2G", "2dd"]  // Delete lines 2-3
    });

    const registers = await manager.callTool("vim_show_registers", {});
    expect(registers.content[0].text).toContain('"1'); // Should contain line2\nline3
  });
});