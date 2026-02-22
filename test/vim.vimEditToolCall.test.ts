// test/vim.vimEditToolCall.test.ts
import { VimToolManager } from "../src/utils/vim";
import { XmlProcessor } from "../src/utils/xmlProcessor";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);
const mkdir = promisify(fs.mkdir);

describe("vim_edit tool call", () => {
  let manager: VimToolManager;
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(__dirname, "temp_vim_edit_toolcall");
    if (!fs.existsSync(testDir)) {
      await mkdir(testDir, { recursive: true });
    }
    manager = new VimToolManager(testDir);
  });

  afterEach(async () => {
    try {
      if (fs.existsSync(testDir)) {
        const files = await fs.promises.readdir(testDir);
        for (const file of files) {
          await unlink(path.join(testDir, file));
        }
      }
    } catch {
      // ignore cleanup errors
    }
  });


// test/vim.vimEditToolCall.test.ts

describe("creating a new file from scratch", () => {
  it("should create hello.py with insert commands", async () => {
    const filePath = path.join(testDir, "hello.py");

    const result = await manager.callTool("vim_edit", {
      file_path: filePath,
      commands: [
        "i",                         // Enter insert mode
        "#!/usr/bin/env python3",    // Line 1
        "\n",                        // New line
        "\n",                        // Another new line
        "# Simple greeting program", // Comment
        "\n",                        // New line
        "\n",                        // Another new line
        "def greet():",              // Function definition
        "\n",                        // New line
        '    """Returns a greeting message"""', // Docstring
        "\n",                        // New line
        '    return "Hello, World!"', // Return statement
        "\n",                        // New line
        "\n",                        // Another new line
        "def __main__():",            // Main function
        "\n",                        // New line
        "    print(greet())",         // Print statement
        "\n",                        // New line
        "\n",                        // Another new line
        'if __name__ == "__main__":', // Main guard
        "\n",                        // New line
        "    __main__()",             // Call main
        "\x1b",                       // Exit insert mode
        ":w",                         // Save
      ],
    });

    expect(result.isError).toBeFalsy();
    
    const content = await readFile(filePath, "utf-8");
    const expectedLines = [
      "#!/usr/bin/env python3",
      "",
      "# Simple greeting program",
      "",
      "def greet():",
      '    """Returns a greeting message"""',
      '    return "Hello, World!"',
      "",
      "def __main__():",
      "    print(greet())",
      "",
      'if __name__ == "__main__":',
      "    __main__()",
      ""
    ];
    
    const actualLines = content.split("\n");
    expectedLines.forEach((line, index) => {
      expect(actualLines[index]).toBe(line);
    });
  });
});

describe("commands as a newline-separated string", () => {
  it("should split string commands on newlines and filter blanks", async () => {
    const filePath = path.join(testDir, "from_string.txt");

    const result = await manager.callTool("vim_edit", {
      file_path: filePath,
      commands: "i\nHello\ni\nWorld\n\x1b\n:w",
    });

    expect(result.isError).toBeFalsy();
    const content = await readFile(filePath, "utf-8");
    const lines = content.split("\n").filter(line => line !== '');
    expect(lines[0]).toBe("Hello");
    expect(lines[1]).toBe("World");
  });
});

describe("editing an existing file", () => {
  it("should modify an existing file with substitution", async () => {
    const filePath = path.join(testDir, "existing.py");
    await writeFile(filePath, 'msg = "Hello"\nprint(msg)\n', "utf-8");

    const result = await manager.callTool("vim_edit", {
      file_path: filePath,
      commands: [':%s/Hello/Goodbye/g', ":w"],
    });

    expect(result.isError).toBeFalsy();
    const content = await readFile(filePath, "utf-8");
    expect(content).toContain('msg = "Goodbye"');
    expect(content).not.toContain('msg = "Hello"');
  });

  it("should delete lines matching a pattern", async () => {
    const filePath = path.join(testDir, "cleanup.py");
    await writeFile(
      filePath,
      "import os\nconsole.log('debug')\ndef main():\n    pass\nconsole.log('end')\n",
      "utf-8"
    );

    const result = await manager.callTool("vim_edit", {
      file_path: filePath,
      commands: [":g/console\\.log/d", ":w"],
    });

    expect(result.isError).toBeFalsy();
    const content = await readFile(filePath, "utf-8");
    expect(content).not.toContain("console.log");
    expect(content).toContain("import os");
    expect(content).toContain("def main():");
    expect(content).toContain("    pass");
  });
});

describe("XML parsing round-trip", () => {
  it("should parse vim_edit CDATA with insert commands and blank lines", async () => {
    const filePath = path.join(testDir, "mixed.py");

    const xml = `<tool_call name="vim_edit">
  <file_path>${filePath}</file_path>
  <commands><![CDATA[
i
# Header


def foo():
    pass

\x1b
:w
]]></commands>
</tool_call>`;

    const toolCalls = XmlProcessor.extractToolCalls(xml);
    const result = await manager.callTool("vim_edit", toolCalls[0].args);

    expect(result.isError).toBeFalsy();
    const content = await readFile(filePath, "utf-8");
    const lines = content.split("\n");
    expect(lines[0]).toBe("# Header");
    expect(lines[1]).toBe("");
    expect(lines[2]).toBe("");
    expect(lines[3]).toBe("def foo():");
    expect(lines[4]).toBe("    pass");
    expect(lines[5]).toBe("");
  });
});

describe("multi-buffer workflow", () => {
  it("should create two files and yank/put between them", async () => {
    const fileA = path.join(testDir, "a.txt");
    const fileB = path.join(testDir, "b.txt");

    // Create file A with content
    const result1 = await manager.callTool("vim_edit", {
      file_path: fileA,
      commands: [
        "i",              // Enter insert mode
        "Shared line",    // First line
        "\n",             // New line
        "Only in A",      // Second line
        "\x1b",           // Exit insert mode
        ":w",             // Save
      ],
    });
    expect(result1.isError).toBeFalsy();

    // Yank the first line from file A
    const result2 = await manager.callTool("vim_edit", {
      file_path: fileA,
      commands: ["gg", '"ayy'],
    });
    expect(result2.isError).toBeFalsy();

    // Create file B with content
    const result3 = await manager.callTool("vim_edit", {
      file_path: fileB,
      commands: [
        "i",              // Enter insert mode
        "File B content", // Content
        "\x1b",           // Exit insert mode
        ":w",             // Save
      ],
    });
    expect(result3.isError).toBeFalsy();

    // Put the yanked line into file B
    const result4 = await manager.callTool("vim_edit", {
      file_path: fileB,
      commands: [
        "G",              // Go to end of file
        '"ap',            // Put from register a
        ":w",             // Save
      ],
    });
    expect(result4.isError).toBeFalsy();

    const contentB = await readFile(fileB, "utf-8");
    const lines = contentB.split("\n").filter(line => line !== '');
    expect(lines).toContain("Shared line");
    expect(lines).toContain("File B content");
  });
});

});