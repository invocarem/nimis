// test/vim.print.test.ts
import { VimToolManager } from "../src/utils/vim";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);
const mkdir = promisify(fs.mkdir);

describe("VimToolManager - Print Command", () => {
  let manager: VimToolManager;
  let testDir: string;
  let testFile: string;

  beforeEach(async () => {
    testDir = path.join(__dirname, "temp_print_test");
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

  it("should print file content with :%print after :e", async () => {
    // Create a simple test file
    const content = "hello world\nfoo bar\nbaz qux\n";
    await writeFile(testFile, content, "utf-8");

    // Load file and print it
    const result = await manager.callTool("vim", {
      file_path: testFile,
      commands: [
        ":e test.txt",
        ":%print"
      ]
    });

    expect(result.isError).toBeFalsy();
    
    // The output should contain the file content
    const output = result.content[0].text;
    expect(output).toContain("hello world");
    expect(output).toContain("foo bar");
    expect(output).toContain("baz qux");
  });

  it("should print current line only with :print", async () => {
    const content = "line1\nline2\nline3\n";
    await writeFile(testFile, content, "utf-8");

    const result = await manager.callTool("vim", {
      file_path: testFile,
      commands: [
        ":e test.txt",
        "2G",  // Go to line 2
        ":print"
      ]
    });

    expect(result.isError).toBeFalsy();
    
    const output = result.content[0].text;
    expect(output).toContain("line2");
    expect(output).not.toContain("line1");
    expect(output).not.toContain("line3");
  });

  it("should print line range with :2,4print", async () => {
    const content = "line1\nline2\nline3\nline4\nline5\n";
    await writeFile(testFile, content, "utf-8");

    const result = await manager.callTool("vim", {
      file_path: testFile,
      commands: [
        ":e test.txt",
        ":2,4print"
      ]
    });

    expect(result.isError).toBeFalsy();
    
    const output = result.content[0].text;
    expect(output).toContain("line2");
    expect(output).toContain("line3");
    expect(output).toContain("line4");
    expect(output).not.toContain("line1");
    expect(output).not.toContain("line5");
  });

  it("should print line with offset range :+1,+1print after /UPRI/", async () => {
    const content = "header\n<UPRI>\n  <version>1</version>\n  <other>x</other>\n";
    await writeFile(testFile, content, "utf-8");

    const result = await manager.callTool("vim", {
      file_path: testFile,
      commands: [
        ":e test.txt",
        ":/UPRI/",
        ":+1,+1print"
      ]
    });

    expect(result.isError).toBeFalsy();
    const output = result.content[0].text;
    expect(output).toContain("Jumped to line 2");
    expect(output).toContain("  <version>1</version>");
    expect(output).not.toContain("<other>");
  });

  it("should print line with offset range :+2,+2print (2 lines below current)", async () => {
    const content = "L1\nL2\nL3\nL4\nL5\n";
    await writeFile(testFile, content, "utf-8");

    const result = await manager.callTool("vim", {
      file_path: testFile,
      commands: [
        ":e test.txt",
        "1G",  // Go to line 1 (L1)
        ":+2,+2print"
      ]
    });

    expect(result.isError).toBeFalsy();
    const output = result.content[0].text;
    expect(output).toContain("L3");  // 2 lines below L1
    expect(output).not.toContain("L1");
    expect(output).not.toContain("L2");
  });
});
