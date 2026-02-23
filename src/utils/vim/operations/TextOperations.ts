import type { VimBuffer, Range } from "../types";
import { shiftDeleteRegisters } from "../models/VimRegister";

/** Convert Vim replacement escapes to JavaScript replace() format */
function escapeReplacementForJs(replacement: string): string {
  return replacement
    .replace(/\\\$/g, "$$")       // \$ -> $$ (literal $)
    .replace(/\\\./g, ".")        // \. -> . (literal .)
    .replace(/\\&/g, "$&")        // \& -> $& (whole match)
    .replace(/\\0/g, "$&")        // \0 -> $& (whole match)
    .replace(/\\([1-9]\\d{0,1})(?![0-9])/g, (_, n) => "$" + n);  // \1-\99 -> $1-$99 (backreferences)
}

export function substituteWithPattern(
  range: Range,
  pattern: string,
  replacement: string,
  flags: string,
  buffer: VimBuffer
): string {
  try {
    if (!pattern) {
      throw new Error("Empty pattern");
    }
    // Use 'g' only when explicitly requested (Vim: s/foo/bar/ = first only, s/foo/bar/g = all)
    let regexFlags = flags.includes("g") ? "g" : "";
    if (flags.includes("i")) {
      regexFlags += "i";
    }
    const regex = new RegExp(pattern, regexFlags);
    const jsReplacement = escapeReplacementForJs(replacement);
    let replaceCount = 0;

    for (let i = range.start; i <= range.end; i++) {
      const line = buffer.content[i];
      const newLine = line.replace(regex, jsReplacement);
      if (newLine !== line) {
        buffer.content[i] = newLine;
        const matches = line.match(new RegExp(pattern, flags.includes("g") ? (flags.includes("i") ? "gi" : "g") : (flags.includes("i") ? "i" : "")));
        replaceCount += flags.includes("g") ? (matches ? matches.length : 0) : 1;
      }
    }

    if (replaceCount > 0) {
      buffer.modified = true;
    }

    return `Substituted ${replaceCount} occurrence${replaceCount !== 1 ? 's' : ''} on ${range.end - range.start + 1} line(s)`;
  } catch (e) {
    throw new Error(`Invalid pattern: ${pattern}`);
  }
}
export function substituteWithPatternLegacy(
  range: Range,
  pattern: string,
  replacement: string,
  flags: string,
  buffer: VimBuffer
): string {
  try {
    const regex = new RegExp(pattern, flags.includes('i') ? 'i' : '');
    const global = flags.includes('g');
    let replaceCount = 0;

    for (let i = range.start; i <= range.end; i++) {
      const line = buffer.content[i];
      if (global) {
        const newLine = line.replace(new RegExp(pattern, 'g'), replacement);
        if (newLine !== line) {
          buffer.content[i] = newLine;
          const matches = line.match(new RegExp(pattern, 'g'));
          replaceCount += matches ? matches.length : 0;
        }
      } else {
        const newLine = line.replace(regex, replacement);
        if (newLine !== line) {
          buffer.content[i] = newLine;
          replaceCount++;
        }
      }
    }

    if (replaceCount > 0) {
      buffer.modified = true;
    }

    return `Substituted ${replaceCount} occurrence${replaceCount !== 1 ? 's' : ''} on ${range.end - range.start + 1} line(s)`;
  } catch (e) {
    throw new Error(`Invalid pattern: ${pattern}`);
  }
}

export function substitute(
  range: Range,
  args: string | undefined,
  buffer: VimBuffer
): string {
  if (!args) {
    throw new Error(':s requires pattern and replacement');
  }

  const match = args.match(/^\/([^/]+)\/([^/]*)\/([gci]*)$/);
  if (!match) {
    throw new Error('Invalid substitute format. Use :s/pattern/replacement/flags');
  }

  const [_, pattern, replacement, flags] = match;
  return substituteWithPattern(range, pattern, replacement, flags, buffer);
}




export function putLinesLegacy(
  before: boolean,
  register: string | undefined,
  buffer: VimBuffer
): string {
  const regName = register || '"';
  const reg = buffer.registers.get(regName);

  if (!reg || !reg.content || (Array.isArray(reg.content) && reg.content.length === 0)) {
    throw new Error(`Register ${regName} is empty`);
  }

  const linesToPut = Array.isArray(reg.content) ? reg.content : [reg.content];
  const insertPos = before ? buffer.currentLine : buffer.currentLine + 1;

  buffer.content.splice(insertPos, 0, ...linesToPut);
  buffer.currentLine = insertPos + linesToPut.length - 1;
  buffer.modified = true;

  return `Put ${linesToPut.length} line(s) from register ${regName}`;
}



export function normalExCommand(
  range: { start: number; end: number } | null,
  args: string | undefined,
  buffer: VimBuffer
): string {
  if (!args) {
    throw new Error(':normal requires a command');
  }

  const targetRange = range || { start: buffer.currentLine, end: buffer.currentLine };
  let executedCount = 0;

  for (let i = targetRange.start; i <= targetRange.end; i++) {
    buffer.currentLine = i;
    executedCount++;
  }

  return `Executed normal command on ${executedCount} line(s)`;
}

export function setMark(
  args: string | undefined,
  buffer: VimBuffer
): string {
  if (!args || args.length !== 1) {
    throw new Error(':ma requires a single letter mark');
  }

  const mark = args[0];
  if (!/[a-z]/.test(mark)) {
    throw new Error('Marks must be a-z');
  }

  buffer.marks.set(mark, buffer.currentLine);
  return `Mark '${mark} set at line ${buffer.currentLine + 1}`;
}
export function yankLines(
  range: Range,
  register: string | undefined,
  buffer: VimBuffer
): string {
  const regName = register || '"';
  const yankedLines = buffer.content.slice(range.start, range.end + 1);

  // Store in specified register
  buffer.registers.set(regName, {
    type: 'linewise',
    content: [...yankedLines]
  });
  
  // Also store in register 0 (yank register)
  buffer.registers.set('0', { 
    type: 'linewise', 
    content: [...yankedLines] 
  });
  
  // Store in unnamed register
  buffer.registers.set('"', { 
    type: 'linewise', 
    content: [...yankedLines] 
  });

  return `Yanked ${yankedLines.length} line(s) to register ${regName}`;
}

export function deleteLines(
  range: Range,
  register: string | undefined,
  buffer: VimBuffer
): string {
  const regName = register || '"';
  const deletedLines = buffer.content.slice(range.start, range.end + 1);

  // Store in specified register
  buffer.registers.set(regName, {
    type: 'linewise',
    content: [...deletedLines]
  });

  // Store in unnamed register
  buffer.registers.set('"', {
    type: 'linewise',
    content: [...deletedLines]
  });

  // Shift numbered registers
  shiftDeleteRegisters(buffer, deletedLines);

  const deletedCount = range.end - range.start + 1;
  buffer.content.splice(range.start, deletedCount);

  // Vim convention: buffer must have at least one line (empty line if nothing else)
  if (buffer.content.length === 0) {
    buffer.content.push('');
  }
  buffer.modified = true;

  // Adjust marks
  for (const [mark, line] of buffer.marks) {
    if (line >= range.start && line <= range.end) {
      buffer.marks.delete(mark);
    } else if (line > range.end) {
      buffer.marks.set(mark, line - deletedCount);
    }
  }

  // Adjust cursor position
  if (buffer.currentLine >= range.start) {
    if (buffer.currentLine <= range.end) {
      buffer.currentLine = Math.min(range.start, Math.max(0, buffer.content.length - 1));
    } else {
      buffer.currentLine -= deletedCount;
    }
  }

  return `Deleted ${deletedLines.length} line(s) to register ${regName}`;
}

export async function globalCommand(
  args: string | undefined,
  inverse: boolean,
  buffer: VimBuffer
): Promise<string> {
  if (!args) {
    throw new Error(':g requires a pattern and command');
  }

  const match = args.match(/^\/([^/]+)\/(.*)$/);
  if (!match) {
    throw new Error('Invalid global command format. Use :g/pattern/command');
  }

  const [_, pattern, command] = match;
  try {
    const regex = new RegExp(pattern);

    // Find matching lines
    const matchingLines: number[] = [];
    for (let i = 0; i < buffer.content.length; i++) {
      const matches = regex.test(buffer.content[i]);
      if ((matches && !inverse) || (!matches && inverse)) {
        matchingLines.push(i);
      }
    }

    // Execute command on matching lines (from bottom to top to preserve line numbers)
    let executedCount = 0;
    for (let i = matchingLines.length - 1; i >= 0; i--) {
      const lineNum = matchingLines[i];
      const oldLine = buffer.currentLine;
      buffer.currentLine = lineNum;

      // Handle different commands
      const trimmedCmd = command.trim();
      if (trimmedCmd === 'd') {
        deleteLines({ start: lineNum, end: lineNum }, undefined, buffer);
        executedCount++;
      } else if (trimmedCmd.startsWith('s/')) {
        // Handle substitution on matching lines
        const subMatch = trimmedCmd.match(/^s\/([^/]+)\/([^/]*)\/([gci]*)$/);
        if (subMatch) {
          const [_, subPattern, replacement, flags] = subMatch;
          substituteWithPattern(
            { start: lineNum, end: lineNum },
            subPattern, replacement, flags, buffer
          );
          executedCount++;
        }
      }

      buffer.currentLine = oldLine;
    }

    return `Executed command on ${executedCount} matching line(s)`;
  } catch (e) {
    throw new Error(`Invalid pattern: ${pattern}`);
  }
}

// In TextOperations.ts - fix putLines to handle multiple puts correctly
export function putLines(
  before: boolean,
  register: string | undefined,
  buffer: VimBuffer
): string {
  const regName = register || '"';
  const reg = buffer.registers.get(regName);

  if (!reg || !reg.content || (Array.isArray(reg.content) && reg.content.length === 0)) {
    throw new Error(`Register ${regName} is empty`);
  }

  const linesToPut = Array.isArray(reg.content) ? reg.content : [reg.content];
  const insertPos = before ? buffer.currentLine : buffer.currentLine + 1;

  buffer.content.splice(insertPos, 0, ...linesToPut);
  
  // Update cursor position to the last inserted line
  if (before) {
    buffer.currentLine = insertPos;
  } else {
    buffer.currentLine = insertPos + linesToPut.length - 1;
  }
  
  buffer.modified = true;

  return `Put ${linesToPut.length} line(s) from register ${regName}`;
}