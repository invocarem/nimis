// editFileHandler.ts
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import { assertWithinWorkspace } from "./workspacePath";

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

export interface NativeToolResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

export class EditFileHandler {
  constructor(private workspaceRoot?: string) {}

  async editFile(filePath: string, oldText: string, newText: string): Promise<NativeToolResult> {
    try {
      // Basic validation
      if (!oldText || !newText) {
        return {
          content: [{ type: "text", text: "Error: old_text and new_text are required" }],
          isError: true,
        };
      }

      // Check line count (minimum 3 lines for safety)
      const lineCount = oldText.split('\n').length;
      if (lineCount < 3) {
        return {
          content: [{ 
            type: "text", 
            text: `Error: Please include at least 3 lines of context. Current: ${lineCount} line(s). Use read_file to copy exact text.` 
          }],
          isError: true,
        };
      }

      // Resolve path
      const resolvedPath = this.resolvePath(filePath);
      
      // Read file
      let content: string;
      try {
        content = await readFile(resolvedPath, "utf-8");
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Error reading file: ${error.message}` }],
          isError: true,
        };
      }

      // Try exact match first
      if (content.includes(oldText)) {
        const newContent = content.replace(oldText, newText);
        await writeFile(resolvedPath, newContent, "utf-8");
        return {
          content: [{ type: "text", text: `Successfully edited ${path.basename(filePath)}` }],
        };
      }

      // Try with normalized line endings (handle CRLF vs LF)
      const normalizedContent = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const normalizedOldText = oldText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

      if (normalizedContent.includes(normalizedOldText)) {
        // Preserve original line endings
        const hasCRLF = content.includes('\r\n');
        const normalizedNewText = newText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        let newContent = normalizedContent.replace(normalizedOldText, normalizedNewText);
        
        if (hasCRLF) {
          newContent = newContent.replace(/\n/g, '\r\n');
        }
        
        await writeFile(resolvedPath, newContent, "utf-8");
        return {
          content: [{ type: "text", text: `Successfully edited ${path.basename(filePath)} (line endings normalized)` }],
        };
      }

      // If not found, show helpful error
      const contentPreview = content.split('\n').slice(0, 10).map((l, i) => `${i + 1}: ${l.substring(0, 80)}`).join('\n');
      const oldPreview = oldText.split('\n').slice(0, 3).join('\n');
      
      return {
        content: [{
          type: "text",
          text: `Error: Text not found in file.\n\nYour text (first 3 lines):\n${oldPreview}\n\nFile preview (first 10 lines):\n${contentPreview}\n\nUse read_file to get exact text from the file.`
        }],
        isError: true,
      };

    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Error editing file: ${error.message}` }],
        isError: true,
      };
    }
  }

  private resolvePath(filePath: string): string {
    if (!this.workspaceRoot) {
      throw new Error(
        "No workspace root available. Cannot resolve path safely."
      );
    }

    const resolved = path.isAbsolute(filePath)
      ? path.resolve(filePath)
      : path.resolve(this.workspaceRoot, filePath);

    assertWithinWorkspace(resolved, this.workspaceRoot);
    return resolved;
  }
}