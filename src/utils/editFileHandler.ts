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
  private _workspaceRootProvider: () => string | undefined;

  constructor(workspaceRoot?: string | (() => string | undefined)) {
    if (typeof workspaceRoot === "function") {
      this._workspaceRootProvider = workspaceRoot;
    } else if (workspaceRoot) {
      const root = workspaceRoot;
      this._workspaceRootProvider = () => root;
    } else {
      this._workspaceRootProvider = () => undefined;
    }
  }

  private get workspaceRoot(): string | undefined {
    return this._workspaceRootProvider();
  }

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

  async editLines(
    filePath: string,
    lineStart: number,
    lineEnd: number | undefined,
    newText: string
  ): Promise<NativeToolResult> {
    try {
      if (newText === undefined || newText === null) {
        return {
          content: [{ type: "text", text: "Error: new_text is required" }],
          isError: true,
        };
      }

      const effectiveEnd = lineEnd ?? lineStart;

      if (!Number.isInteger(lineStart) || lineStart < 1) {
        return {
          content: [{ type: "text", text: `Error: line_start must be a positive integer (got ${lineStart})` }],
          isError: true,
        };
      }
      if (!Number.isInteger(effectiveEnd) || effectiveEnd < 1) {
        return {
          content: [{ type: "text", text: `Error: line_end must be a positive integer (got ${effectiveEnd})` }],
          isError: true,
        };
      }
      if (effectiveEnd < lineStart) {
        return {
          content: [{ type: "text", text: `Error: line_end (${effectiveEnd}) cannot be less than line_start (${lineStart})` }],
          isError: true,
        };
      }

      const resolvedPath = this.resolvePath(filePath);

      let content: string;
      try {
        content = await readFile(resolvedPath, "utf-8");
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Error reading file: ${error.message}` }],
          isError: true,
        };
      }

      const lineEnding = content.includes('\r\n') ? '\r\n' : '\n';
      const lines = content.split(/\r?\n/);
      const totalLines = lines.length;

      if (lineStart > totalLines) {
        return {
          content: [{
            type: "text",
            text: `Error: line_start (${lineStart}) exceeds total lines in file (${totalLines})`
          }],
          isError: true,
        };
      }
      if (effectiveEnd > totalLines) {
        return {
          content: [{
            type: "text",
            text: `Error: line_end (${effectiveEnd}) exceeds total lines in file (${totalLines})`
          }],
          isError: true,
        };
      }

      const before = lines.slice(0, lineStart - 1);
      const after = lines.slice(effectiveEnd);
      const replacementLines = newText.split(/\r?\n/);

      const newLines = [...before, ...replacementLines, ...after];
      const newContent = newLines.join(lineEnding);

      await writeFile(resolvedPath, newContent, "utf-8");

      const linesReplaced = effectiveEnd - lineStart + 1;
      const summary = lineStart === effectiveEnd
        ? `line ${lineStart}`
        : `lines ${lineStart}-${effectiveEnd} (${linesReplaced} lines)`;

      return {
        content: [{
          type: "text",
          text: `Successfully edited ${path.basename(filePath)}: replaced ${summary} with ${replacementLines.length} line(s)`
        }],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Error editing file by lines: ${error.message}` }],
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