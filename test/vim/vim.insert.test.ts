// test/vim/vim.insert.test.ts
import { VimToolManager } from "../../src/utils/vim";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);
const unlink = promisify(fs.unlink);

describe("VimToolManager - Insert at line (e.g. :11i)", () => {
  let manager: VimToolManager;
  let testDir: string;
  let testFile: string;

  beforeEach(async () => {
    testDir = path.join(__dirname, "temp_insert_test");
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
      if (fs.existsSync(testDir)) {
        const files = await fs.promises.readdir(testDir);
        for (const file of files) {
          await unlink(path.join(testDir, file));
        }
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  it("should insert text at line 11 using :11i", async () => {
    const lines = Array.from({ length: 15 }, (_, i) => `line ${i + 1}`);
    const content = lines.join("\n") + "\n";
    await writeFile(testFile, content, "utf-8");

    const result = await manager.callTool("vim", {
      file_path: testFile,
      commands: [
        ":11i",       // Go to line 11 (Ex command) and enter insert mode
        "PREFIX ",   // Text to insert
        "\x1b",      // Escape to normal mode
        ":w",
      ],
    });

    expect(result.isError).toBeFalsy();

    const updated = await readFile(testFile, "utf-8");
    const resultLines = updated.trimEnd().split("\n");
    expect(resultLines[10]).toBe("PREFIX line 11");
  });

});
