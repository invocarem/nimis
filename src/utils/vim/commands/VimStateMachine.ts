// src/utils/vim/commands/VimStateMachine.ts
import { VimState, createVimState } from "../models/VimMode";
import type { VimBuffer } from "../types";
import { NormalCommandHandler } from "./NormalCommandHandler";
import { ExCommandHandler } from "./ExCommandHandler";
import { CommandContext } from "../types";

export class VimStateMachine {
  private static readonly MULTI_KEY_PREFIXES = new Set(['d', 'g', 'y', 'c']);

  private state: VimState;
  private normalHandler: NormalCommandHandler;
  private exHandler: ExCommandHandler;

  constructor(
    private ctx: CommandContext,
    initialState?: VimState
  ) {
    this.state = initialState || createVimState();
    this.normalHandler = new NormalCommandHandler();
    this.exHandler = new ExCommandHandler(ctx);
    
    // Sync initial cursor position
    if (this.state.buffer) {
      this.syncCursorToHandler(this.state.buffer);
    }
  }

  getState(): VimState {
    return this.state;
  }

  setBuffer(buffer: VimBuffer): void {
    this.state.buffer = buffer;
    if (!buffer) return;
    
    // Ensure cursor position is within bounds
    this.state.cursorPosition.line = Math.min(
      this.state.cursorPosition.line,
      Math.max(0, buffer.content.length - 1)
    );
    
    if (buffer.content.length > 0) {
      this.state.cursorPosition.column = Math.min(
        this.state.cursorPosition.column,
        buffer.content[this.state.cursorPosition.line]?.length || 0
      );
    }
    
    // Sync with normal handler
    this.syncCursorToHandler(buffer);
  }

  async processKey(key: string): Promise<{ output: string; stateChanged: boolean }> {
    if (!this.state.buffer) {
      return { output: "No buffer active", stateChanged: false };
    }

    switch (this.state.mode) {
      case 'normal':
        return this.processNormalMode(key);
      case 'insert':
        return this.processInsertMode(key);
      case 'command-line':
        return await this.processCommandLineMode(key);
      default:
        return { output: `Unknown mode: ${this.state.mode}`, stateChanged: false };
    }
  }

  private processNormalMode(key: string): { output: string; stateChanged: boolean } {
    const buffer = this.state.buffer!;

    // '0' with no pending numeric prefix is a movement command, not a digit
    if (key === '0' && !this.state.pendingCommand) {
      this.state.cursorPosition.column = 0;
      this.normalHandler.setCursorColumn(0);
      return { output: 'Moved to beginning of line', stateChanged: false };
    }

    // Accumulate numeric prefixes (1-9 always, 0 only when extending an existing prefix)
    if (/^[1-9]$/.test(key) || (key === '0' && this.state.pendingCommand && /\d/.test(this.state.pendingCommand))) {
      this.state.pendingCommand = (this.state.pendingCommand || '') + key;
      return { output: `(pending: ${this.state.pendingCommand})`, stateChanged: false };
    }

    // Pending command exists — decide whether to accumulate or execute
    if (this.state.pendingCommand) {
      // Waiting for register name after '"'
      if (this.state.pendingCommand.endsWith('"')) {
        this.state.pendingCommand += key;
        return { output: `(pending: ${this.state.pendingCommand})`, stateChanged: false };
      }

      // Register selected (e.g. "a or 3"a) but operator not yet started —
      // accumulate multi-key operator prefixes; single-key commands fall through to execute
      if (/^\d*"[a-zA-Z](\d*)$/.test(this.state.pendingCommand) && VimStateMachine.MULTI_KEY_PREFIXES.has(key)) {
        this.state.pendingCommand += key;
        return { output: `(pending: ${this.state.pendingCommand})`, stateChanged: false };
      }

      const isAllDigits = /^\d+$/.test(this.state.pendingCommand);

      // A digit-only prefix followed by a multi-key operator: keep accumulating
      if (isAllDigits && VimStateMachine.MULTI_KEY_PREFIXES.has(key)) {
        this.state.pendingCommand += key;
        return { output: `(pending: ${this.state.pendingCommand})`, stateChanged: false };
      }

      // Otherwise the key completes the command
      const fullCommand = this.state.pendingCommand + key;
      this.state.pendingCommand = undefined;

      this.syncCursorToHandler(buffer);
      try {
        const result = this.normalHandler.execute(fullCommand, buffer);
        this.syncCursorFromHandler(buffer);
        return { output: result, stateChanged: false };
      } catch (e) {
        return { output: `Error: ${e}`, stateChanged: false };
      }
    }

    // No pending — a multi-key operator starts a new pending sequence
    if (VimStateMachine.MULTI_KEY_PREFIXES.has(key)) {
      this.state.pendingCommand = key;
      return { output: `(pending: ${this.state.pendingCommand})`, stateChanged: false };
    }

    // Register prefix starts a new pending sequence
    if (key === '"') {
      this.state.pendingCommand = '"';
      return { output: `(pending: ${this.state.pendingCommand})`, stateChanged: false };
    }

    // Mark set (m{a-z}) and mark jump ('{a-z}) need one more character
    if (key === 'm' || key === "'") {
      this.state.pendingCommand = key;
      return { output: `(pending: ${this.state.pendingCommand})`, stateChanged: false };
    }

    // Mode switching commands
    switch (key) {
      case 'i':
        this.syncCursorToHandler(buffer);
        this.state.mode = 'insert';
        this.state.pendingCommand = undefined;
        return { output: "-- INSERT --", stateChanged: true };

      case 'a': {
        // First sync the buffer's currentLine with our cursor position
        this.syncCursorToHandler(buffer);
        
        // Move cursor right one position if not at end of line
        const currentLineText = buffer.content[this.state.cursorPosition.line];
        if (this.state.cursorPosition.column < currentLineText.length) {
          this.state.cursorPosition.column++;
        }
        // If at end of line, we stay there (appending at end)
        
        this.state.mode = 'insert';
        this.state.pendingCommand = undefined;
        return { output: "-- INSERT --", stateChanged: true };
      }
 
      case 'A':
        this.syncCursorToHandler(buffer);
        this.state.cursorPosition.column = buffer.content[this.state.cursorPosition.line].length;
        this.state.mode = 'insert';
        this.state.pendingCommand = undefined;
        return { output: "-- INSERT --", stateChanged: true };

      case 'I':
        this.syncCursorToHandler(buffer);
        this.state.cursorPosition.column = 0;
        this.state.mode = 'insert';
        this.state.pendingCommand = undefined;
        return { output: "-- INSERT --", stateChanged: true };

      case 'o': {
        this.syncCursorToHandler(buffer);
        buffer.content.splice(buffer.currentLine + 1, 0, '');
        buffer.currentLine++;
        this.state.cursorPosition.line = buffer.currentLine;
        this.state.cursorPosition.column = 0;
        buffer.modified = true;
        this.state.mode = 'insert';
        this.state.pendingCommand = undefined;
        return { output: "-- INSERT --", stateChanged: true };
      }

      case 'O': {
        this.syncCursorToHandler(buffer);
        buffer.content.splice(buffer.currentLine, 0, '');
        this.state.cursorPosition.line = buffer.currentLine;
        this.state.cursorPosition.column = 0;
        buffer.modified = true;
        this.state.mode = 'insert';
        this.state.pendingCommand = undefined;
        return { output: "-- INSERT --", stateChanged: true };
      }

      case ':':
        this.state.mode = 'command-line';
        this.state.commandBuffer = ':';
        this.state.pendingCommand = undefined;
        return { output: ':', stateChanged: true };

      default:
        this.syncCursorToHandler(buffer);
        try {
          const result = this.normalHandler.execute(key, buffer);
          this.syncCursorFromHandler(buffer);
          return { output: result, stateChanged: false };
        } catch (e) {
          return { output: `Error: ${e}`, stateChanged: false };
        }
    }
  }

  private processInsertMode(key: string): { output: string; stateChanged: boolean } {
    const buffer = this.state.buffer!;

    // Handle Escape to return to normal mode
    if (key === '\x1b' || key === 'Esc') {
      this.state.mode = 'normal';
      // In Vim, Escape moves cursor left one position, but only if not at beginning of line
      if (this.state.cursorPosition.column > 0) {
        this.state.cursorPosition.column--;
      }
      // Update the normal handler's cursor position
      this.normalHandler.setCursorColumn(this.state.cursorPosition.column);
      buffer.currentLine = this.state.cursorPosition.line;
      return { output: "-- NORMAL --", stateChanged: true };
    }

    if (key === '\n' || key === '\r') {
      const currentLine = buffer.content[this.state.cursorPosition.line];
      const beforeCursor = currentLine.substring(0, this.state.cursorPosition.column);
      const afterCursor = currentLine.substring(this.state.cursorPosition.column);
      
      buffer.content[this.state.cursorPosition.line] = beforeCursor;
      buffer.content.splice(this.state.cursorPosition.line + 1, 0, afterCursor);
      
      this.state.cursorPosition.line++;
      this.state.cursorPosition.column = 0;
      buffer.modified = true;
      return { output: '\n', stateChanged: false };
    }

    // Handle Backspace
    if (key === '\b' || key === '\x7f') {
      if (this.state.cursorPosition.column > 0) {
        // Delete character before cursor
        const line = buffer.content[this.state.cursorPosition.line];
        buffer.content[this.state.cursorPosition.line] =
          line.substring(0, this.state.cursorPosition.column - 1) +
          line.substring(this.state.cursorPosition.column);
        this.state.cursorPosition.column--;
        buffer.modified = true;
      } else if (this.state.cursorPosition.line > 0) {
        // Join with previous line
        const currentLine = buffer.content[this.state.cursorPosition.line];
        const prevLine = buffer.content[this.state.cursorPosition.line - 1];
        
        buffer.content[this.state.cursorPosition.line - 1] = prevLine + currentLine;
        buffer.content.splice(this.state.cursorPosition.line, 1);
        
        this.state.cursorPosition.line--;
        this.state.cursorPosition.column = prevLine.length;
        buffer.modified = true;
      }
      return { output: '', stateChanged: false };
    }

    // Handle Tab
    if (key === '\t') {
      const line = buffer.content[this.state.cursorPosition.line];
      buffer.content[this.state.cursorPosition.line] =
        line.substring(0, this.state.cursorPosition.column) +
        '  ' + // Insert 2 spaces for tab
        line.substring(this.state.cursorPosition.column);

      this.state.cursorPosition.column += 2;
      buffer.modified = true;
      return { output: '  ', stateChanged: false };
    }

    // Insert regular character
    if (key.length === 1) {
      const line = buffer.content[this.state.cursorPosition.line];
      buffer.content[this.state.cursorPosition.line] =
        line.substring(0, this.state.cursorPosition.column) +
        key +
        line.substring(this.state.cursorPosition.column);

      this.state.cursorPosition.column++;
      buffer.modified = true;
      return { output: key, stateChanged: false };
    }

    return { output: '', stateChanged: false };
  }

  private async processCommandLineMode(key: string): Promise<{ output: string; stateChanged: boolean }> {
    // Handle Escape to cancel command-line mode
    if (key === '\x1b' || key === 'Esc') {
      this.state.mode = 'normal';
      this.state.commandBuffer = '';
      return { output: '-- CANCELLED --', stateChanged: true };
    }

    // Handle Enter to execute command
    if (key === '\n' || key === '\r') {
      const command = this.state.commandBuffer.substring(1); // Remove ':'
      this.state.mode = 'normal';
      this.state.commandBuffer = '';

      if (!command.trim()) {
        return { output: '', stateChanged: true };
      }

      try {
        // Sync cursor before executing command
        this.syncCursorToHandler(this.state.buffer!);
        
        // Execute the Ex command
        const result = await this.exHandler.execute(command, this.state.buffer!);
        
        // Sync cursor after execution
        this.syncCursorFromHandler(this.state.buffer!);
        return { output: result, stateChanged: true };
      } catch (e) {
        return { output: `Error: ${e}`, stateChanged: true };
      }
    }

    // Handle Backspace in command line
    if (key === '\b' || key === '\x7f') {
      if (this.state.commandBuffer.length > 1) {
        this.state.commandBuffer = this.state.commandBuffer.slice(0, -1);
      }
      return { output: this.state.commandBuffer, stateChanged: false };
    }

    // Add character to command buffer
    if (key.length === 1) {
      this.state.commandBuffer += key;
    }

    return { output: this.state.commandBuffer, stateChanged: false };
  }

  private getIndentation(line: string): string {
    const match = line.match(/^\s*/);
    return match ? match[0] : '';
  }

  private moveCursorLeft(): void {
    if (!this.state.buffer) return;

    if (this.state.cursorPosition.column > 0) {
      this.state.cursorPosition.column--;
    } else if (this.state.cursorPosition.line > 0) {
      this.state.cursorPosition.line--;
      this.state.cursorPosition.column =
        this.state.buffer.content[this.state.cursorPosition.line].length;
    }
  }

  private moveCursorRight(): void {
    if (!this.state.buffer) return;

    const currentLine = this.state.buffer.content[this.state.cursorPosition.line];
    // Only move right if not at the end of line
    if (this.state.cursorPosition.column < currentLine.length) {
      this.state.cursorPosition.column++;
    }
    // Don't wrap to next line
  }

  private syncCursorToHandler(buffer: VimBuffer): void {
    buffer.currentLine = this.state.cursorPosition.line;
    this.normalHandler.setCursorColumn(this.state.cursorPosition.column);
  }

  private syncCursorFromHandler(buffer: VimBuffer): void {
    this.state.cursorPosition.line = buffer.currentLine;
    this.state.cursorPosition.column = this.normalHandler.getCursorColumn();
  }
}