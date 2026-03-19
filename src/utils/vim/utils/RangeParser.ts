import type { VimBuffer, Range } from "../types";
import { vimPatternToJs } from "../operations/TextOperations";

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
    let regex: RegExp;
    try {
      regex = new RegExp(vimPatternToJs(pattern));
    } catch (e) {
      // vimPatternToJs may produce invalid regex (e.g. unbalanced groups from
      // LLM-style \( escapes).  Fall back to literal interpretation: un-escape
      // vim backslash sequences then escape for JS regex.
      const literal = pattern.replace(/\\(.)/g, '$1');
      try {
        regex = new RegExp(literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      } catch {
        throw new Error(`Invalid pattern: ${pattern}`);
      }
    }
    for (let i = buffer.currentLine; i < buffer.content.length; i++) {
      if (regex.test(buffer.content[i])) {
        return { start: i, end: i };
      }
    }
    for (let i = 0; i < buffer.currentLine; i++) {
      if (regex.test(buffer.content[i])) {
        return { start: i, end: i };
      }
    }
    throw new Error(`Pattern not found: ${pattern}`);
  }

  const parts = rangeStr.split(',').map(p => p.trim());
  if (parts.length === 1) {
    const line = parseLineRef(parts[0], buffer);
    return { start: line, end: line };
  }

  let start = parseLineRef(parts[0], buffer);
  let end = parseLineRef(parts[1], buffer);

  // Vim allows reverse ranges (e.g. :59,40d) and swaps them to start..end.
  // When cursor is past EOF (e.g. :470 on a short file then .,+24print), end can be < start;
  // in that case we swap so start <= end.
  if (end < start) {
    [start, end] = [end, start];
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

  // Line 0: virtual line before first line (for :0put, :0a, etc.)
  if (ref === '0') {
    return -1;
  }

  const num = parseInt(ref, 10);
  if (isNaN(num) || num < 0) {
    throw new Error(`Invalid line number: ${ref}`);
  }
  return num - 1;
}
