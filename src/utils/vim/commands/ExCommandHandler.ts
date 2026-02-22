// src/commands/ExCommandHandler.ts
import * as path from "path";
import type { VimBuffer, CommandContext } from "../types";
import { parseRange } from "../utils/RangeParser";
import {
  substituteWithPattern,
  deleteLines,
  yankLines,
  putLines,
  globalCommand,
  normalExCommand,
  setMark,
} from "../operations/TextOperations";
import {
  editFile,
  writeBuffer,
  readFileIntoBuffer,
  saveAs,
  externalCommand,
} from "../operations/FileOperations";
import {
  formatBufferList,
  getNextBuffer,
  getPreviousBuffer,
  switchToBuffer,
} from "../operations/BufferOperations";
import { formatRegisters } from "../models/VimRegister";

export class ExCommandHandler {
  constructor(private ctx: CommandContext) {}

  async execute(cmd: string, buffer: VimBuffer): Promise<string> {
    if (!cmd) {
      return '';
    }

    // Mark references (e.g. 'ap), but not mark ranges like 'a,'bd
    if (cmd.startsWith("'") && !cmd.match(/^'[a-z],/)) {
      const match = cmd.match(/^'([a-z])(.*)$/);
      if (match) {
        const [_, mark, rest] = match;
        const line = buffer.marks.get(mark);
        if (line !== undefined) {
          buffer.currentLine = line;
          if (rest) {
            return this.execute(rest, buffer);
          }
          return `Jumped to mark '${mark}`;
        }
        // Mark not set — try register interpretation as fallback
        try {
          return await this.execute(`"${mark}${rest}`, buffer);
        } catch {
          throw new Error(`Mark '${mark} not set`);
        }
      }
    }

    // Register references (e.g. "ap)
    if (cmd.startsWith('"')) {
      const match = cmd.match(/^"([a-z0-9"])(.*)$/);
      if (match) {
        const [_, reg, rest] = match;
        if (rest === 'p' || rest === 'P') {
          return putLines(rest === 'P', reg, buffer);
        }
        buffer.lastRegister = reg;
        if (rest) {
          return this.execute(rest, buffer);
        }
        return '';
      }
    }

    // %s/ substitution
    if (cmd.startsWith('%s/')) {
      const subMatch = cmd.substring(3).match(/^([^/]+)\/([^/]*)\/([gci]*)$/);
      if (!subMatch) {
        throw new Error('Invalid substitute format. Use :%s/pattern/replacement/flags');
      }
      const [_, pattern, replacement, flags] = subMatch;
      return substituteWithPattern({ start: 0, end: buffer.content.length - 1 }, pattern, replacement, flags, buffer);
    }

    // Range-based substitution (e.g. 10,20s/old/new/g)
    const rangeSubMatch = cmd.match(/^(\d+,\d+)s\/([^/]+)\/([^/]*)\/([gci]*)$/);
    if (rangeSubMatch) {
      const [_, rangeStr, pattern, replacement, flags] = rangeSubMatch;
      try {
        const range = parseRange(rangeStr, buffer);
        return substituteWithPattern(range, pattern, replacement, flags, buffer);
      } catch (e) {
        throw new Error(`Invalid range: ${rangeStr}`);
      }
    }

    // Simple substitution on current line (e.g. s/old/new/g)
    const simpleSubMatch = cmd.match(/^s\/([^/]+)\/([^/]*)\/([gci]*)$/);
    if (simpleSubMatch) {
      const [_, pattern, replacement, flags] = simpleSubMatch;
      return substituteWithPattern(
        { start: buffer.currentLine, end: buffer.currentLine },
        pattern, replacement, flags, buffer
      );
    }

    // Try to parse a range prefix
    let range: { start: number; end: number } | null = null;
    let rest = cmd;

    // Search pattern range: /pattern1/,/pattern2/ command
    const twoPatternMatch = cmd.match(/^(\/[^/]+\/)\s*,\s*(\/[^/]+\/)\s*(.+)$/);
    if (twoPatternMatch) {
      const [_, pat1Str, pat2Str, restOfCmd] = twoPatternMatch;
      try {
        const regex1 = new RegExp(pat1Str.slice(1, -1));
        const regex2 = new RegExp(pat2Str.slice(1, -1));

        let startLine = -1;
        for (let i = buffer.currentLine; i < buffer.content.length; i++) {
          if (regex1.test(buffer.content[i])) { startLine = i; break; }
        }
        if (startLine === -1) {
          for (let i = 0; i < buffer.currentLine; i++) {
            if (regex1.test(buffer.content[i])) { startLine = i; break; }
          }
        }
        if (startLine === -1) throw new Error(`Pattern not found: ${pat1Str}`);

        let endLine = -1;
        for (let i = startLine; i < buffer.content.length; i++) {
          if (regex2.test(buffer.content[i])) { endLine = i; break; }
        }
        if (endLine === -1) throw new Error(`Pattern not found: ${pat2Str}`);

        range = { start: startLine, end: endLine };
        rest = restOfCmd.trim();
      } catch (e: any) {
        if (e.message?.includes('Pattern not found')) throw e;
        rest = cmd;
      }
    }

    // Single search pattern range: /pattern/command
    if (!range) {
      const singlePatternMatch = cmd.match(/^(\/[^/]+\/)(.+)$/);
      if (singlePatternMatch) {
        try {
          range = parseRange(singlePatternMatch[1], buffer);
          rest = singlePatternMatch[2].trim();
        } catch (e) {
          rest = cmd;
        }
      }
    }

    // Generic range prefix (numbers, marks, %, $, etc.)
    if (!range) {
      const rangeMatch = cmd.match(/^((?:[%$.0-9,/\\+-]|'[a-z])+)(.*)$/);
      if (rangeMatch) {
        const rangeStr = rangeMatch[1].trim();
        if (/^(?:[%$.0-9,/\\+-]|'[a-z])+$/.test(rangeStr)) {
          try {
            range = parseRange(rangeStr, buffer);
            rest = rangeMatch[2].trim();
          } catch (e) {
            rest = cmd;
          }
        } else {
          rest = cmd;
        }
      }
    }

    // Handle substitution after range extraction (e.g. /pattern/s/old/new/g)
    if (rest.startsWith('s/')) {
      const subParts = rest.substring(2).match(/^([^/]+)\/([^/]*)\/([gci]*)$/);
      if (!subParts) {
        throw new Error('Invalid substitute format. Use :s/pattern/replacement/flags');
      }
      const [_, sp, sr, sf] = subParts;
      return substituteWithPattern(range || { start: buffer.currentLine, end: buffer.currentLine }, sp, sr, sf, buffer);
    }

    // Handle g/pattern/cmd and v/pattern/cmd without space separator
    const globalMatch = rest.match(/^(g|v)(\/[^/]+\/.*)$/);
    if (globalMatch) {
      const [_, gv, gargs] = globalMatch;
      return await globalCommand(gargs, gv === 'v', buffer);
    }

    // Handle external command (! prefix) before splitting on whitespace,
    // since the shell command after ! may not have a space separator (e.g. %!sort)
    if (rest.startsWith('!')) {
      return await externalCommand(range, rest.substring(1).trim() || undefined, buffer);
    }

    const cmdParts = rest.split(/\s+/);
    const cmdName = cmdParts[0];
    const args = cmdParts.slice(1).join(' ');

    switch (cmdName) {
      case 'e':
        if (!args) throw new Error(':e requires a filename');
        await editFile(args, this.ctx);
        return `Editing ${path.basename(args)}`;

      case 'w':
        await writeBuffer(buffer);
        return `"${path.basename(buffer.path)}" ${buffer.content.length}L written`;

      case 'q':
        if (buffer.modified) throw new Error('No write since last change (use :q! to force quit)');
        this.ctx.buffers.delete(buffer.path);
        this.ctx.setCurrentBuffer(getNextBuffer(this.ctx.buffers, null));
        return `Closed ${path.basename(buffer.path)}`;

      case 'wq':
        await writeBuffer(buffer);
        this.ctx.buffers.delete(buffer.path);
        this.ctx.setCurrentBuffer(getNextBuffer(this.ctx.buffers, null));
        return `"${path.basename(buffer.path)}" written and closed`;

      case 'q!':
        this.ctx.buffers.delete(buffer.path);
        this.ctx.setCurrentBuffer(getNextBuffer(this.ctx.buffers, null));
        return `Closed ${path.basename(buffer.path)} (changes discarded)`;

      case 'bn':
      case 'bnext': {
        const next = getNextBuffer(this.ctx.buffers, this.ctx.getCurrentBuffer());
        this.ctx.setCurrentBuffer(next);
        return `Editing ${path.basename(next?.path || '')}`;
      }

      case 'bp':
      case 'bprevious': {
        const prev = getPreviousBuffer(this.ctx.buffers, this.ctx.getCurrentBuffer());
        this.ctx.setCurrentBuffer(prev);
        return `Editing ${path.basename(prev?.path || '')}`;
      }

      case 'ls':
      case 'buffers':
        return formatBufferList(this.ctx.buffers, this.ctx.getCurrentBuffer());

      case 'b':
        if (!args) throw new Error(':b requires buffer number or name');
        this.ctx.setCurrentBuffer(await switchToBuffer(args, this.ctx.buffers));
        return `Editing ${path.basename(this.ctx.getCurrentBuffer()?.path || '')}`;

      case 'r':
        if (!args) throw new Error(':r requires a filename');
        return await readFileIntoBuffer(args, buffer);

      case 'saveas':
        if (!args) throw new Error(':saveas requires a filename');
        return await saveAs(args, buffer, this.ctx.buffers);

      case 'reg':
      case 'registers':
        return formatRegisters(buffer);

      case 'ma':
      case 'mark':
        return setMark(args, buffer);

      case 'd':
        return deleteLines(range || { start: buffer.currentLine, end: buffer.currentLine }, args || undefined, buffer);

      case 'y':
        return yankLines(range || { start: buffer.currentLine, end: buffer.currentLine }, args || undefined, buffer);

      case 'p':
      case 'pu':
        return putLines(false, args || buffer.lastRegister || undefined, buffer);

      case 'pu!':
        return putLines(true, args || buffer.lastRegister || undefined, buffer);

      case 'P':
        return putLines(true, args || buffer.lastRegister || undefined, buffer);

      case 'g':
        return await globalCommand(args, false, buffer);

      case 'v':
        return await globalCommand(args, true, buffer);

      case 'norm':
      case 'normal':
        return normalExCommand(range, args, buffer);

      case '!':
        return await externalCommand(range, args, buffer);

      default:
        throw new Error(`Unsupported Ex command: ${cmdName}`);
    }
  }
}