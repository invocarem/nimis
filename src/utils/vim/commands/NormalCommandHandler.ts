// src/commands/NormalCommandHandler.ts
import type { VimBuffer } from "../types";
import { deleteLines, yankLines, putLines } from "../operations/TextOperations";

export class NormalCommandHandler {
  // Track cursor column position (0-based)
  private cursorColumn: number = 0;

  execute(cmd: string, buffer: VimBuffer): string {
    if (!cmd) {
      return '';
    }

    // Set mark: m{a-z}
    const markSetMatch = cmd.match(/^m([a-z])$/);
    if (markSetMatch) {
      const mark = markSetMatch[1];
      buffer.marks.set(mark, buffer.currentLine);
      return `Mark '${mark} set at line ${buffer.currentLine + 1}`;
    }

    // Jump to mark: '{a-z} (bare, no trailing command)
    const markJumpMatch = cmd.match(/^'([a-z])$/);
    if (markJumpMatch) {
      const mark = markJumpMatch[1];
      const line = buffer.marks.get(mark);
      if (line === undefined) {
        throw new Error(`Mark '${mark} not set`);
      }
      buffer.currentLine = line;
      this.cursorColumn = 0; // Reset cursor to start of line
      return `Jumped to mark '${mark}`;
    }

    // '{a-z}{cmd}: if mark exists, jump to it then execute cmd; otherwise treat as register shorthand
    const markCmdMatch = cmd.match(/^'([a-z])(.+)$/);
    if (markCmdMatch) {
      const mark = markCmdMatch[1];
      const rest = markCmdMatch[2];
      const line = buffer.marks.get(mark);
      if (line !== undefined) {
        buffer.currentLine = line;
        this.cursorColumn = 0;
        return this.execute(rest, buffer);
      }
      buffer.lastRegister = mark;
      return this.execute(`"${mark}${rest}`, buffer);
    }

    // Handle complex commands like "2Gdd" or "3G2dd"
    const complexMatch = cmd.match(/^(\d+)G(\d*)([a-z]+)$/);
    if (complexMatch) {
      const [_, lineNumStr, countStr, operation] = complexMatch;
      const lineNum = parseInt(lineNumStr, 10);
      const count = countStr ? parseInt(countStr, 10) : 1;
      
      // First, move to the specified line
      if (lineNum >= 1 && lineNum <= buffer.content.length) {
        buffer.currentLine = lineNum - 1; // Convert to 0-based
        this.cursorColumn = 0; // Reset cursor to start of line
      } else {
        throw new Error(`Line ${lineNum} out of range`);
      }
      
      // Then execute the operation with the count
      switch (operation) {
        case 'dd':
          deleteLines(
            { start: buffer.currentLine, end: Math.min(buffer.content.length - 1, buffer.currentLine + count - 1) },
            undefined,
            buffer
          );
          return `Deleted ${count} line(s) from line ${lineNum}`;
          
        case 'yy':
          yankLines(
            { start: buffer.currentLine, end: Math.min(buffer.content.length - 1, buffer.currentLine + count - 1) },
            undefined,
            buffer
          );
          return `Yanked ${count} line(s) from line ${lineNum}`;
          
        default:
          throw new Error(`Unsupported operation in complex command: ${operation}`);
      }
    }

    // Handle line number navigation like "2G"
    if (/^\d+G$/.test(cmd)) {
      const lineNum = parseInt(cmd.slice(0, -1), 10);
      if (lineNum >= 1 && lineNum <= buffer.content.length) {
        buffer.currentLine = lineNum - 1; // Convert to 0-based
        this.cursorColumn = 0; // Reset cursor to start of line
        return `Moved to line ${lineNum}`;
      }
      throw new Error(`Line ${lineNum} out of range`);
    }

    let count = 1;
    let remainingCmd = cmd;

    // Parse count prefix
    const countMatch = cmd.match(/^(\d+)/);
    if (countMatch) {
      count = parseInt(countMatch[1], 10);
      remainingCmd = cmd.substring(countMatch[1].length);
    }

    // Parse register prefix (e.g., "ayy)
    let register: string | undefined;
    if (remainingCmd.startsWith('"') && remainingCmd.length > 1) {
      register = remainingCmd[1];
      remainingCmd = remainingCmd.substring(2);
      buffer.lastRegister = register;
    }

    // G followed by another command (e.g. Go = go to end + open line below)
    if (remainingCmd.startsWith('G') && remainingCmd.length > 1) {
      buffer.currentLine = buffer.content.length - 1;
      this.cursorColumn = 0; // Reset cursor to start of line
      return this.execute(remainingCmd.slice(1), buffer);
    }

    // Insert text at cursor position: i{text}
    if (remainingCmd.startsWith('i') && remainingCmd.length > 1) {
      const text = remainingCmd.substring(1);
      const currentLine = buffer.content[buffer.currentLine];
      
      // Insert text at current cursor position
      const beforeCursor = currentLine.substring(0, this.cursorColumn);
      const afterCursor = currentLine.substring(this.cursorColumn);
      buffer.content[buffer.currentLine] = beforeCursor + text + afterCursor;
      
      // Move cursor to end of inserted text
      this.cursorColumn += text.length;
      buffer.modified = true;
      return `Inserted: ${text}`;
    }

    // Append text at end of line: a{text}
    if (remainingCmd.startsWith('a') && remainingCmd.length > 1) {
      const text = remainingCmd.substring(1);
      const currentLine = buffer.content[buffer.currentLine];
      
      buffer.content[buffer.currentLine] = currentLine + text;
      
      this.cursorColumn = buffer.content[buffer.currentLine].length - 1;
      buffer.modified = true;
      return `Appended: ${text}`;
    }

    // Enter insert mode (no text)
    if (remainingCmd === 'i') {
      return 'Entering insert mode at cursor position';
    }

    // Enter append mode (no text)
    if (remainingCmd === 'a') {
      this.cursorColumn++; // Move cursor one position right for append
      return 'Entering append mode after cursor';
    }

    // Open new line below and enter insert mode
    if (remainingCmd === 'o') {
      buffer.content.splice(buffer.currentLine + 1, 0, '');
      buffer.currentLine++;
      this.cursorColumn = 0;
      buffer.modified = true;
      return 'Opened new line below';
    }

    // Open new line above and enter insert mode
    if (remainingCmd === 'O') {
      buffer.content.splice(buffer.currentLine, 0, '');
      this.cursorColumn = 0;
      buffer.modified = true;
      return 'Opened new line above';
    }

    switch (remainingCmd) {
      case 'dd':
        deleteLines(
          { start: buffer.currentLine, end: Math.min(buffer.content.length - 1, buffer.currentLine + count - 1) },
          register,
          buffer
        );
        this.cursorColumn = 0; // Reset cursor after deletion
        return `Deleted ${count} line(s)`;

      case 'yy':
      case 'Y':
        yankLines(
          { start: buffer.currentLine, end: Math.min(buffer.content.length - 1, buffer.currentLine + count - 1) },
          register,
          buffer
        );
        return `Yanked ${count} line(s)`;

      case 'p':
        for (let i = 0; i < count; i++) {
          putLines(false, register, buffer);
        }
        this.cursorColumn = 0; // Reset cursor after put
        return `Put from register ${register || '"'}`;

      case 'P':
        for (let i = 0; i < count; i++) {
          putLines(true, register, buffer);
        }
        this.cursorColumn = 0; // Reset cursor after put
        return `Put from register ${register || '"'}`;

      case 'dw':
        if (buffer.content.length > 0 && buffer.currentLine < buffer.content.length) {
          const line = buffer.content[buffer.currentLine];
          // Delete from cursor to end of word
          const beforeCursor = line.substring(0, this.cursorColumn);
          const afterCursor = line.substring(this.cursorColumn);
          const wordMatch = afterCursor.match(/^\s*\S+\s*/);
          if (wordMatch) {
            const newLine = beforeCursor + afterCursor.substring(wordMatch[0].length);
            buffer.content[buffer.currentLine] = newLine;
            buffer.modified = true;
            return 'Deleted word';
          }
        }
        return 'No word found';

      case 'j':
        buffer.currentLine = Math.min(buffer.content.length - 1, buffer.currentLine + count);
        this.cursorColumn = 0; // Reset cursor when moving lines
        return `Moved down ${count} line(s)`;

      case 'k':
        buffer.currentLine = Math.max(0, buffer.currentLine - count);
        this.cursorColumn = 0; // Reset cursor when moving lines
        return `Moved up ${count} line(s)`;

      case 'gg':
        buffer.currentLine = 0;
        this.cursorColumn = 0;
        return 'Moved to top';

      case 'G':
        buffer.currentLine = buffer.content.length - 1;
        this.cursorColumn = buffer.content[buffer.currentLine].length;
        return 'Moved to bottom';

      case '0':
      case '^':
        this.cursorColumn = 0;
        return `Moved to beginning of line`;

      case '$':
        this.cursorColumn = buffer.content[buffer.currentLine].length;
        return `Moved to end of line`;

      case 'l':
        this.cursorColumn = Math.min(
          buffer.content[buffer.currentLine].length,
          this.cursorColumn + count
        );
        return `Moved right ${count} character(s)`;

      case 'h':
        this.cursorColumn = Math.max(0, this.cursorColumn - count);
        return `Moved left ${count} character(s)`;

      default:
        throw new Error(`Unsupported normal mode command: ${remainingCmd}`);
    }
  }
}