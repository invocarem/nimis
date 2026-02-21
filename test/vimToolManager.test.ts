// vimToolManager.test.ts
import { VimToolManager } from "../src/utils/vim";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);
const mkdir = promisify(fs.mkdir);
const readdir = promisify(fs.readdir);

describe("VimToolManager", () => {
  let manager: VimToolManager;
  let testDir: string;
  let testFile: string;
  let testFile2: string;

  beforeEach(async () => {
    testDir = path.join(__dirname, "temp_vim_test_files");
    testFile = path.join(testDir, "test_edit.py");
    testFile2 = path.join(testDir, "test_edit2.py");
    
    // Create test directory if it doesn't exist
    if (!fs.existsSync(testDir)) {
      await mkdir(testDir, { recursive: true });
    }

    manager = new VimToolManager(testDir);
  });

  afterEach(async () => {
    // Clean up test files
    try {
      if (fs.existsSync(testFile)) {
        await unlink(testFile);
      }
      if (fs.existsSync(testFile2)) {
        await unlink(testFile2);
      }
      if (fs.existsSync(testDir)) {
        const files = await readdir(testDir);
        for (const file of files) {
          if (file.endsWith('.bak')) {
            await unlink(path.join(testDir, file));
          }
        }
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe("Basic file operations", () => {
    it("should create a new file with :e and write with :w", async () => {
      const result = await manager.callTool("vim_edit", {
        file_path: testFile,
        commands: [
          "i# This is a test file",
          "i",
          "idef test_function():",
          "i    return 'hello world'",
          ":w"
        ]
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain("Executed 5 command(s)");
      expect(result.content[0].text).toContain("Current buffer:");

      // Verify file was created
      const content = await readFile(testFile, "utf-8");
      expect(content).toContain("# This is a test file");
      expect(content).toContain("def test_function():");
      expect(content).toContain("    return 'hello world'");
    });

    it("should read an existing file", async () => {
        const originalContent = "line 1\nline 2\nline 3\n";
        await writeFile(testFile, originalContent, "utf-8");

        const filename = path.basename(testFile);
        
        const result = await manager.callTool("vim_edit", {
            file_path: testFile,
            commands: []
        });

        expect(result.isError).toBeFalsy();
        expect(result.content[0].text).toContain(filename);
    });
    

    it("should handle file not found gracefully", async () => {
      const result = await manager.callTool("vim_edit", {
        file_path: path.join(testDir, "nonexistent.py"),
        commands: [":e nonexistent.py", "i# New file", ":w"]
      });

      expect(result.isError).toBeFalsy(); // Should create new file
      expect(result.content[0].text).toContain("Executed 3 command(s)");
    });
  });

  describe("Line ending normalization", () => {
    it("should preserve CRLF line endings when editing", async () => {
      // Create a file with CRLF line endings
      const originalContent = "def divide(a, b):\r\n \"\"\"Return the quotient.\"\"\"\r\n if b == 0:\r\n raise ValueError(\"Cannot divide by zero\")\r\n return a / b\r\n";
      await writeFile(testFile, originalContent, "utf-8");

      // Edit using Vim substitution
      const result = await manager.callTool("vim_edit", {
        file_path: testFile,
        commands: [
          ":%s/Cannot divide by zero/Division by zero is not allowed/g",
          ":w"
        ]
      });

      expect(result.isError).toBeFalsy();

      // Verify file was updated and CRLF preserved
      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toContain("Division by zero is not allowed");
      expect(updatedContent).toContain("\r\n");
    });

    it("should preserve LF line endings when editing", async () => {
      // Create a file with LF line endings
      const originalContent = "def divide(a, b):\n \"\"\"Return the quotient.\"\"\"\n if b == 0:\n raise ValueError(\"Cannot divide by zero\")\n return a / b\n";
      await writeFile(testFile, originalContent, "utf-8");

      const result = await manager.callTool("vim_edit", {
        file_path: testFile,
        commands: [
          ":%s/Cannot divide by zero/Division by zero is not allowed/g",
          ":w"
        ]
      });

      expect(result.isError).toBeFalsy();

      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toContain("Division by zero is not allowed");
      expect(updatedContent).not.toContain("\r\n");
    });
  });

  describe("Substitution commands", () => {
    beforeEach(async () => {
      const content = "line 1\nline 2\nline 3\nline 2\nline 4\n";
      await writeFile(testFile, content, "utf-8");
    });

    it("should substitute in entire file with :%s", async () => {
      const result = await manager.callTool("vim_edit", {
        file_path: testFile,
        commands: [
          ":%s/line 2/line TWO/g",
          ":w"
        ]
      });

      expect(result.isError).toBeFalsy();

      const content = await readFile(testFile, "utf-8");
      expect(content).toBe("line 1\nline TWO\nline 3\nline TWO\nline 4\n");
    });

    it("should substitute in range with :10,20s", async () => {
      // Create longer file
      const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
      await writeFile(testFile, lines.join('\n'), "utf-8");

      const result = await manager.callTool("vim_edit", {
        file_path: testFile,
        commands: [
          ":10,20s/line/XLINE/g",
          ":w"
        ]
      });

      expect(result.isError).toBeFalsy();

      const content = await readFile(testFile, "utf-8");
      const contentLines = content.split('\n');
      
      // Lines 10-20 should be changed
      for (let i = 0; i < 30; i++) {
        if (i >= 9 && i <= 19) { // 0-indexed
          expect(contentLines[i]).toBe(`XLINE ${i + 1}`);
        } else {
          expect(contentLines[i]).toBe(`line ${i + 1}`);
        }
      }
    });

    it("should handle case-insensitive flag", async () => {
      const content = "LINE 1\nLine 2\nline 3\n";
      await writeFile(testFile, content, "utf-8");

      const result = await manager.callTool("vim_edit", {
        file_path: testFile,
        commands: [
          ":%s/line/XXX/gi",
          ":w"
        ]
      });

      expect(result.isError).toBeFalsy();

      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toBe("XXX 1\nXXX 2\nXXX 3\n");
    });
  });

  describe("Delete and yank operations", () => {
    beforeEach(async () => {
      const content = "line 1\nline 2\nline 3\nline 4\nline 5\n";
      await writeFile(testFile, content, "utf-8");
    });

    it("should delete lines with :d", async () => {
      const result = await manager.callTool("vim_edit", {
        file_path: testFile,
        commands: [
          ":2,4d",
          ":w"
        ]
      });

      expect(result.isError).toBeFalsy();

      const content = await readFile(testFile, "utf-8");
      expect(content).toBe("line 1\nline 5\n");
    });

    it("should yank and put lines", async () => {
      const result = await manager.callTool("vim_edit", {
        file_path: testFile,
        commands: [
          ":2,3y a",
          "Go", // Go to end and insert new line
          "iPasted:",
          "'ap", // Put from register a
          ":w"
        ]
      });

      expect(result.isError).toBeFalsy();

      const content = await readFile(testFile, "utf-8");
      expect(content).toContain("Pasted:\nline 2\nline 3");
    });

    it("should delete lines to register and put elsewhere", async () => {
      const result = await manager.callTool("vim_edit", {
        file_path: testFile,
        commands: [
          ":2d a", // Delete line 2 to register a
          "G", // Go to end
          "'ap", // Put from register a
          ":w"
        ]
      });

      expect(result.isError).toBeFalsy();

      const content = await readFile(testFile, "utf-8");
      expect(content).toBe("line 1\nline 3\nline 4\nline 5\nline 2\n");
    });
  });

  describe("Global commands", () => {
    beforeEach(async () => {
      const content = "apple\nbanana\napple pie\ncherry\nbanana split\n";
      await writeFile(testFile, content, "utf-8");
    });

    it("should delete lines matching pattern with :g", async () => {
      const result = await manager.callTool("vim_edit", {
        file_path: testFile,
        commands: [
          ":g/apple/d",
          ":w"
        ]
      });

      expect(result.isError).toBeFalsy();

      const content = await readFile(testFile, "utf-8");
      expect(content).toBe("banana\ncherry\nbanana split\n");
    });

    it("should delete lines NOT matching pattern with :v", async () => {
      const result = await manager.callTool("vim_edit", {
        file_path: testFile,
        commands: [
          ":v/apple/d",
          ":w"
        ]
      });

      expect(result.isError).toBeFalsy();

      const content = await readFile(testFile, "utf-8");
      expect(content).toBe("apple\napple pie\n");
    });
  });

  describe("Marks and registers", () => {
    it("should set and use marks", async () => {
      const content = "line 1\nline 2\nline 3\nline 4\nline 5\n";
      await writeFile(testFile, content, "utf-8");

      const result = await manager.callTool("vim_edit", {
        file_path: testFile,
        commands: [
          "ma", // Set mark a at line 1
          "j", // Move down
          "j", // Move down
          "mb", // Set mark b at line 3
          "'a,'b y c", // Yank lines from mark a to b into register c
          "'ap", // Put from register a
          ":w"
        ]
      });

      expect(result.isError).toBeFalsy();

      // Verify marks via show_marks tool
      const marksResult = await manager.callTool("vim_show_marks", {});
      expect(marksResult.isError).toBeFalsy();
      expect(marksResult.content[0].text).toContain("'a");
      expect(marksResult.content[0].text).toContain("'b");
    });

    it("should show registers content", async () => {
      await manager.callTool("vim_edit", {
        file_path: testFile,
        commands: [
          "i# Test content",
          ":w",
          "yy", // Yank line
          "\"ap", // Put from register a
          ":w"
        ]
      });

      const result = await manager.callTool("vim_show_registers", {});
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('"');
    });
  });

  describe("Multiple buffers", () => {
    beforeEach(async () => {
      await writeFile(testFile, "content of file 1\n", "utf-8");
      await writeFile(testFile2, "content of file 2\n", "utf-8");
    });

    it("should switch between buffers with :bn and :bp", async () => {
      // Edit first file
      await manager.callTool("vim_edit", {
        file_path: testFile,
        commands: [":e " + testFile]
      });

      // Edit second file
      await manager.callTool("vim_edit", {
        file_path: testFile2,
        commands: [":e " + testFile2]
      });

      // List buffers
      const listResult = await manager.callTool("vim_buffer_list", {});
      expect(listResult.isError).toBeFalsy();
      expect(listResult.content[0].text).toContain(path.basename(testFile));
      expect(listResult.content[0].text).toContain(path.basename(testFile2));

      // Switch to next buffer
      const nextResult = await manager.callTool("vim_edit", {
        commands: [":bn"]
      });
      expect(nextResult.content[0].text).toContain(`Editing ${path.basename(testFile)}`);

      // Switch to previous buffer
      const prevResult = await manager.callTool("vim_edit", {
        commands: [":bp"]
      });
      expect(prevResult.content[0].text).toContain(`Editing ${path.basename(testFile2)}`);
    });

    it("should switch to buffer by number with :b", async () => {
      await manager.callTool("vim_edit", { file_path: testFile, commands: [":e " + testFile] });
      await manager.callTool("vim_edit", { file_path: testFile2, commands: [":e " + testFile2] });

      const result = await manager.callTool("vim_edit", {
        commands: [":b 1"]
      });
      expect(result.content[0].text).toContain(`Editing ${path.basename(testFile)}`);
    });
  });

  describe("Normal mode commands", () => {
    beforeEach(async () => {
      const content = "line 1\nline 2\nline 3\nline 4\nline 5\n";
      await writeFile(testFile, content, "utf-8");
    });

    it("should handle dd (delete line)", async () => {
      const result = await manager.callTool("vim_edit", {
        file_path: testFile,
        commands: [
          "2G", // Go to line 2
          "dd",
          ":w"
        ]
      });

      expect(result.isError).toBeFalsy();

      const content = await readFile(testFile, "utf-8");
      expect(content).toBe("line 1\nline 3\nline 4\nline 5\n");
    });

    it("should handle yy (yank line) and p (put)", async () => {
      const result = await manager.callTool("vim_edit", {
        file_path: testFile,
        commands: [
          "2G",
          "yy",
          "G", // Go to end
          "p",
          ":w"
        ]
      });

      expect(result.isError).toBeFalsy();

      const content = await readFile(testFile, "utf-8");
      expect(content).toBe("line 1\nline 2\nline 3\nline 4\nline 5\nline 2\n");
    });

    it("should handle numeric prefixes (3dd)", async () => {
      const result = await manager.callTool("vim_edit", {
        file_path: testFile,
        commands: [
          "2G",
          "3dd",
          ":w"
        ]
      });

      expect(result.isError).toBeFalsy();

      const content = await readFile(testFile, "utf-8");
      expect(content).toBe("line 1\nline 5\n");
    });

    it("should handle movement commands (j, k, gg, G)", async () => {
      const result = await manager.callTool("vim_edit", {
        file_path: testFile,
        commands: [
          "G", // Go to end
          "iEND", // Insert at end
          "gg", // Go to top
          "iSTART", // Insert at top
          ":w"
        ]
      });

      expect(result.isError).toBeFalsy();

      const content = await readFile(testFile, "utf-8");
      expect(content).toBe("STARTline 1\nline 2\nline 3\nline 4\nline 5END\n");
    });
  });

  describe("External commands", () => {
    it("should filter lines through external command with :!", async () => {
      const content = "apple\nbanana\ncherry\n";
      await writeFile(testFile, content, "utf-8");

      const result = await manager.callTool("vim_edit", {
        file_path: testFile,
        commands: [
          ":%!sort",
          ":w"
        ]
      });

      expect(result.isError).toBeFalsy();

      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toBe("apple\nbanana\ncherry\n");
    });

    it("should read file with :r", async () => {
      const content = "original content\n";
      await writeFile(testFile, content, "utf-8");
      
      const extraContent = "extra content\n";
      await writeFile(testFile2, extraContent, "utf-8");

      const result = await manager.callTool("vim_edit", {
        file_path: testFile,
        commands: [
          ":r " + testFile2,
          ":w"
        ]
      });

      expect(result.isError).toBeFalsy();

      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toBe("original content\nextra content\n");
    });

    it("should save as with :saveas", async () => {
      const content = "test content\n";
      await writeFile(testFile, content, "utf-8");

      const newFile = path.join(testDir, "saved_as.txt");
      
      const result = await manager.callTool("vim_edit", {
        file_path: testFile,
        commands: [
          ":saveas " + newFile
        ]
      });

      expect(result.isError).toBeFalsy();

      const savedContent = await readFile(newFile, "utf-8");
      expect(savedContent).toBe(content);

      // Clean up
      await unlink(newFile);
    });
  });

  describe("Error handling and recovery", () => {
    it("should create backup and restore on error", async () => {
      const originalContent = "important content\n";
      await writeFile(testFile, originalContent, "utf-8");

      // Try to execute an invalid command that should error
      const result = await manager.callTool("vim_edit", {
        file_path: testFile,
        commands: [
          ":%s/important/very important/g",
          ":invalid_command", // This will cause error
          ":w"
        ],
        create_backup: true
      });

      expect(result.isError).toBeTruthy();
      expect(result.content[0].text).toContain("Error");

      // Verify file was restored from backup
      const content = await readFile(testFile, "utf-8");
      expect(content).toBe(originalContent);
    });

    it("should prevent writing to unmodified buffer", async () => {
      const content = "test\n";
      await writeFile(testFile, content, "utf-8");

      const result = await manager.callTool("vim_edit", {
        file_path: testFile,
        commands: [
          ":w" // Write without changes
        ]
      });

      expect(result.isError).toBeFalsy(); // Should still work
      expect(result.content[0].text).toContain("written");
    });

    it("should handle quit with unsaved changes", async () => {
      await manager.callTool("vim_edit", {
        file_path: testFile,
        commands: [
          "i# New content",
          ":q" // Try to quit without saving
        ]
      });

      // Should still have buffer open
      const listResult = await manager.callTool("vim_buffer_list", {});
      expect(listResult.content[0].text).toContain("+"); // Modified indicator
    });

    it("should force quit with :q!", async () => {
      await manager.callTool("vim_edit", {
        file_path: testFile,
        commands: [
          "i# New content",
          ":q!" // Force quit
        ]
      });

      const listResult = await manager.callTool("vim_buffer_list", {});
      expect(listResult.content[0].text).toBe("No buffers open");
    });
  });

  describe("Complex editing scenarios", () => {
    it("should refactor a function across multiple files", async () => {
      // Create two files with similar content
      const file1Content = `
function calculateTotal(items) {
  let total = 0;
  for (let i = 0; i < items.length; i++) {
    total += items[i].price;
  }
  return total;
}`;
      const file2Content = `
function calculateTotalWithTax(items) {
  let total = 0;
  for (let i = 0; i < items.length; i++) {
    total += items[i].price;
  }
  return total * 1.1;
}`;

      await writeFile(testFile, file1Content, "utf-8");
      await writeFile(testFile2, file2Content, "utf-8");

      // Refactor to use reduce in both files
      await manager.callTool("vim_edit", {
        file_path: testFile,
        commands: [
          ":/function calculateTotal/,/^}/d a", // Delete function to register a
          "i" + 
          "function calculateTotal(items) {\n" +
          "  return items.reduce((total, item) => total + item.price, 0);\n" +
          "}",
          ":w"
        ]
      });

      await manager.callTool("vim_edit", {
        file_path: testFile2,
        commands: [
          ":/function calculateTotalWithTax/,/^}/d", // Delete old function
          "'ap", // Put from register a
          ":%s/calculateTotal/calculateTotalWithTax/g",
          ":/return /s/$/ * 1.1/", // Add tax multiplier
          ":w"
        ]
      });

      const updatedFile1 = await readFile(testFile, "utf-8");
      const updatedFile2 = await readFile(testFile2, "utf-8");

      expect(updatedFile1).toContain("items.reduce");
      expect(updatedFile2).toContain("items.reduce");
      expect(updatedFile2).toContain("return total * 1.1");
    });

    it("should handle complex search and replace with patterns", async () => {
      const content = `
const api = {
  getUsers: () => fetch('/api/users'),
  getUser: (id) => fetch('/api/users/' + id),
  createUser: (data) => fetch('/api/users', { method: 'POST', body: data }),
  updateUser: (id, data) => fetch('/api/users/' + id, { method: 'PUT', body: data }),
  deleteUser: (id) => fetch('/api/users/' + id, { method: 'DELETE' })
};`;
      await writeFile(testFile, content, "utf-8");

      // Convert to async/await
      const result = await manager.callTool("vim_edit", {
        file_path: testFile,
        commands: [
          ":%s/fetch(.*)/await fetch\\1/g",
          ":%s/:\\s*\\(.*\\) =>/async (\\1) => { return/g",
          ":%s/;\\(\\s*\\)$/ }\\1/g",
          ":%s/const api = {/const api = {\\r  /g", // Add spacing
          ":w"
        ]
      });

      expect(result.isError).toBeFalsy();

      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toContain("async");
      expect(updatedContent).toContain("await fetch");
      expect(updatedContent).toContain("return");
    });
  });
});