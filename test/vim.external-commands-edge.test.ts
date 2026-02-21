// test/vim.external-commands-edge.test.ts
import { VimToolManager } from "../src/utils/vim";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);
const mkdir = promisify(fs.mkdir);


describe("VimToolManager - External Commands Edge Cases", () => {
  let manager: VimToolManager;
  let testDir: string;
  let testFile: string;

  beforeEach(async () => {
    testDir = path.join(__dirname, "temp_external_test");
    testFile = path.join(testDir, "test.txt");
    
    if (!fs.existsSync(testDir)) {
      await mkdir(testDir, { recursive: true });
    }

    manager = new VimToolManager(testDir);
  });

  it("should handle :! with range selection", async () => {
    const content = "3\n1\n4\n1\n5\n9\n2\n6\n";
    await writeFile(testFile, content, "utf-8");

    const result = await manager.callTool("vim_edit", {
      file_path: testFile,
      commands: [
        ":2,5!sort -n",  // Sort lines 2-5 numerically
        ":w"
      ]
    });

    expect(result.isError).toBeFalsy();

    const updatedContent = await readFile(testFile, "utf-8");
    expect(updatedContent).toBe("3\n1\n1\n4\n5\n9\n2\n6\n");
  });

  it("should handle :! with complex shell commands", async () => {
    const content = "apple\nbanana\ncherry\n";
    await writeFile(testFile, content, "utf-8");

    const result = await manager.callTool("vim_edit", {
      file_path: testFile,
      commands: [
        ":%!tr '[:lower:]' '[:upper:]'",  // Convert to uppercase
        ":w"
      ]
    });

    expect(result.isError).toBeFalsy();

    const updatedContent = await readFile(testFile, "utf-8");
    expect(updatedContent).toBe("APPLE\nBANANA\nCHERRY\n");
  });

  it("should handle :! with grep and filter", async () => {
    const content = "error: file not found\ninfo: loading config\nwarning: deprecated\nerror: timeout\n";
    await writeFile(testFile, content, "utf-8");

    const result = await manager.callTool("vim_edit", {
      file_path: testFile,
      commands: [
        ":%!grep error",  // Keep only error lines
        ":w"
      ]
    });

    expect(result.isError).toBeFalsy();

    const updatedContent = await readFile(testFile, "utf-8");
    expect(updatedContent).toBe("error: file not found\nerror: timeout\n");
  });

  it("should handle :! with sed substitutions", async () => {
    const content = "foo bar baz\nbar foo baz\nbaz bar foo\n";
    await writeFile(testFile, content, "utf-8");

    const result = await manager.callTool("vim_edit", {
      file_path: testFile,
      commands: [
        ":%!sed 's/foo/FOO/g'",  // Replace foo with FOO
        ":w"
      ]
    });

    expect(result.isError).toBeFalsy();

    const updatedContent = await readFile(testFile, "utf-8");
    expect(updatedContent).toBe("FOO bar baz\nbar FOO baz\nbaz bar FOO\n");
  });
});
