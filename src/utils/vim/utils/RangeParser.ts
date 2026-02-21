import type { VimBuffer, Range } from "../types";

export function parseRange(rangeStr: string, buffer: VimBuffer): Range {
  if (rangeStr === '%') {
    return { start: 0, end: Math.max(0, buffer.content.length - 1) };
  }

  if (rangeStr === '.') {
    return { start: buffer.currentLine, end: buffer.currentLine };
  }

  if (rangeStr === '$') {
    return { start: buffer.content.length - 1, end: buffer.content.length - 1 };
  }

  if (rangeStr.startsWith("'") && rangeStr.length === 2) {
    const mark = rangeStr[1];
    const line = buffer.marks.get(mark);
    if (line === undefined) {
      throw new Error(`Mark '${mark} not set`);
    }
    return { start: line, end: line };
  }

  if (rangeStr.startsWith('/') && rangeStr.endsWith('/')) {
    const pattern = rangeStr.slice(1, -1);
    try {
      const regex = new RegExp(pattern);
      for (let i = buffer.currentLine + 1; i < buffer.content.length; i++) {
        if (regex.test(buffer.content[i])) {
          return { start: i, end: i };
        }
      }
      for (let i = 0; i <= buffer.currentLine; i++) {
        if (regex.test(buffer.content[i])) {
          return { start: i, end: i };
        }
      }
    } catch (e) {
      throw new Error(`Invalid pattern: ${pattern}`);
    }
    throw new Error(`Pattern not found: ${pattern}`);
  }

  const parts = rangeStr.split(',').map(p => p.trim());
  if (parts.length === 1) {
    const line = parseLineRef(parts[0], buffer);
    return { start: line, end: line };
  }

  const start = parseLineRef(parts[0], buffer);
  const end = parseLineRef(parts[1], buffer);

  if (end < start) {
    throw new Error(`End line ${end + 1} cannot be less than start line ${start + 1}`);
  }

  return { start, end };
}

function parseLineRef(ref: string, buffer: VimBuffer): number {
  if (ref === '.') return buffer.currentLine;
  if (ref === '$') return buffer.content.length - 1;

  if (ref.startsWith("'")) {
    const mark = ref[1];
    const line = buffer.marks.get(mark);
    if (line === undefined) {
      throw new Error(`Mark '${mark} not set`);
    }
    return line;
  }

  if (ref.startsWith('+')) {
    const offset = parseInt(ref.substring(1), 10) || 1;
    return Math.min(buffer.content.length - 1, buffer.currentLine + offset);
  }

  if (ref.startsWith('-')) {
    const offset = parseInt(ref.substring(1), 10) || 1;
    return Math.max(0, buffer.currentLine - offset);
  }

  const num = parseInt(ref, 10);
  if (isNaN(num) || num < 1) {
    throw new Error(`Invalid line number: ${ref}`);
  }
  return num - 1;
}
