import { NativeToolsManager } from "../src/utils/nativeToolManager";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);

describe("NativeToolsManager - editFile", () => {
  let manager: NativeToolsManager;
  let testDir: string;
  let testFile: string;

  beforeEach(() => {
    manager = new NativeToolsManager();
    testDir = path.join(__dirname, "temp_test_files");
    testFile = path.join(testDir, "test_edit.py");
    
    // Create test directory if it doesn't exist
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(async () => {
    // Clean up test files
    try {
      if (fs.existsSync(testFile)) {
        await unlink(testFile);
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe("Line ending normalization", () => {
    it("should handle CRLF line endings in file when old_text has LF", async () => {
      // Create a file with CRLF line endings (Windows style)
      const originalContent = "def divide(a, b):\r\n \"\"\"Return the quotient.\"\"\"\r\n if b == 0:\r\n raise ValueError(\"Cannot divide by zero\")\r\n return a / b\r\n";
      await writeFile(testFile, originalContent, "utf-8");

      // Set workspace root so manager can resolve the path
      (manager as any).workspaceRoot = testDir;

      // old_text has LF line endings (Unix style) - what LLM typically outputs
      const oldText = "def divide(a, b):\n \"\"\"Return the quotient.\"\"\"\n if b == 0:\n raise ValueError(\"Cannot divide by zero\")\n return a / b";
      const newText = "def divide(a, b):\n \"\"\"Return the quotient.\"\"\"\n if b == 0:\n raise ValueError(\"Division by zero is not allowed\")\n return a / b";

      // Execute edit_file
      const result = await (manager as any).editFile(
        path.basename(testFile),
        oldText,
        newText
      );

      // Should succeed
      expect(result.isError).toBeFalsy();
      expect(result.content?.[0]?.text).toContain("Successfully edited");

      // Verify file was updated correctly
      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toContain("Division by zero is not allowed");
      
      // Verify original line endings (CRLF) were preserved
      expect(updatedContent).toContain("\r\n");
    });

    it("should handle LF line endings in file when old_text has LF", async () => {
      // Create a file with LF line endings (Unix style)
      const originalContent = "def divide(a, b):\n \"\"\"Return the quotient.\"\"\"\n if b == 0:\n raise ValueError(\"Cannot divide by zero\")\n return a / b\n";
      await writeFile(testFile, originalContent, "utf-8");

      // Set workspace root
      (manager as any).workspaceRoot = testDir;

      // old_text also has LF line endings
      const oldText = "def divide(a, b):\n \"\"\"Return the quotient.\"\"\"\n if b == 0:\n raise ValueError(\"Cannot divide by zero\")\n return a / b";
      const newText = "def divide(a, b):\n \"\"\"Return the quotient.\"\"\"\n if b == 0:\n raise ValueError(\"Division by zero is not allowed\")\n return a / b";

      // Execute edit_file
      const result = await (manager as any).editFile(
        path.basename(testFile),
        oldText,
        newText
      );

      // Should succeed
      expect(result.isError).toBeFalsy();

      // Verify file was updated and LF line endings preserved
      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toContain("Division by zero is not allowed");
      expect(updatedContent).not.toContain("\r\n");
      expect(updatedContent).toContain("\n");
    });

    it("should handle CRLF line endings in file when old_text has CRLF", async () => {
      // Create a file with CRLF line endings
      const originalContent = "def divide(a, b):\r\n \"\"\"Return the quotient.\"\"\"\r\n if b == 0:\r\n raise ValueError(\"Cannot divide by zero\")\r\n return a / b\r\n";
      await writeFile(testFile, originalContent, "utf-8");

      // Set workspace root
      (manager as any).workspaceRoot = testDir;

      // old_text also has CRLF line endings
      const oldText = "def divide(a, b):\r\n \"\"\"Return the quotient.\"\"\"\r\n if b == 0:\r\n raise ValueError(\"Cannot divide by zero\")\r\n return a / b";
      const newText = "def divide(a, b):\r\n \"\"\"Return the quotient.\"\"\"\r\n if b == 0:\r\n raise ValueError(\"Division by zero is not allowed\")\r\n return a / b";

      // Execute edit_file
      const result = await (manager as any).editFile(
        path.basename(testFile),
        oldText,
        newText
      );

      // Should succeed
      expect(result.isError).toBeFalsy();

      // Verify file was updated and CRLF line endings preserved
      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toContain("Division by zero is not allowed");
      expect(updatedContent).toContain("\r\n");
    });

    it("should preserve file's original line endings after edit", async () => {
      // Create a file with CRLF line endings
      const originalContent = "line 1\r\nline 2\r\nline 3\r\n";
      await writeFile(testFile, originalContent, "utf-8");

      // Set workspace root
      (manager as any).workspaceRoot = testDir;

      // Edit with LF in old_text and new_text
      const oldText = "line 1\nline 2";
      const newText = "line 1\nline 2 (edited)";

      // Execute edit_file
      const result = await (manager as any).editFile(
        path.basename(testFile),
        oldText,
        newText
      );

      // Should succeed
      expect(result.isError).toBeFalsy();

      // Verify CRLF line endings were preserved
      const updatedContent = await readFile(testFile, "utf-8");
      expect(updatedContent).toContain("\r\n");
      expect(updatedContent).toBe("line 1\r\nline 2 (edited)\r\nline 3\r\n");
    });
  });
});
