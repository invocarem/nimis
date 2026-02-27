// src/commands/ExCommandHandler.ts
import * as fs from "fs";
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
import { listDirectory } from "../operations/DirectoryOperations";
import { grepInDirectory } from "../operations/GrepOperations";

/** Parse s/pattern/replacement/flags with support for \delim escaping (e.g. \/ for literal /) */
function parseSubstituteArgs(
  rest: string,
  delim: string
): { pattern: string; replacement: string; flags: string } | null {
  let i = 0;
  const readUntilDelim = (): string => {
    let s = "";
    while (i < rest.length) {
      if (rest[i] === "\\" && i + 1 < rest.length) {
        const next = rest[i + 1];
        if (next === delim) {
          s += delim; // Escaped delimiter -> literal
          i += 2;
          continue;
        }
      }
      if (rest[i] === delim) {
        i++;
        return s;
      }
      s += rest[i++];
    }
    return s;
  };

  const pattern = readUntilDelim();
  if (i > rest.length) return null;
  const replacement = readUntilDelim();
  // Unescape replacement: \/ -> /
  const replacementUnescaped = replacement.replace(
    new RegExp(`\\\\${delim.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g"),
    delim
  );
  const flags = rest.slice(i).trim();
  return { pattern, replacement: replacementUnescaped, flags };
}

const FIND_MAX_ENTRIES = 2000;

/** Search for a file under dir; returns first match where relative path equals or ends with target (path.sep-normalized). */
async function findFileInPath(
  dir: string,
  target: string
): Promise<string | null> {
  const targetBasename = path.basename(target);
  const stack: string[] = [path.resolve(dir)];
  const seen = new Set<string>();
  let entriesVisited = 0;
  while (stack.length > 0 && entriesVisited < FIND_MAX_ENTRIES) {
    const current = stack.pop()!;
    const canonical = path.resolve(current);
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    try {
      const entries = await fs.promises.readdir(current, {
        withFileTypes: true,
      });
      for (const e of entries) {
        entriesVisited++;
        const full = path.join(current, e.name);
        if (e.isFile()) {
          const rel = path.relative(dir, full);
          if (rel === target || rel.endsWith(path.sep + target)) return full;
          if (target === e.name || targetBasename === e.name) return full;
        } else if (e.isDirectory() && !e.name.startsWith(".")) {
          const resolved = path.resolve(full);
          if (!seen.has(resolved)) stack.push(resolved);
        }
      }
    } catch {
      // ignore readdir errors
    }
  }
  return null;
}

const HELP_TOPICS: Record<string, string> = {
  "e": ":e[dit] {file}\n  Open {file} for editing. Creates a new buffer if the file doesn't exist.\n  If {file} is a directory, lists its contents.\n\n  Examples:\n    :e main.ts        Open main.ts\n    :e .              List current directory",

  "w": ":w[rite]\n  Write the current buffer to disk.\n\n  Example:\n    :w                Save current file",

  "q": ":q[uit]\n  Close the current buffer. Fails if there are unsaved changes.\n  Use :q! to force-close and discard changes.\n\n  Examples:\n    :q                Close buffer\n    :q!               Force close, discard changes",

  "wq": ":wq\n  Write current buffer to disk and close it.\n\n  Example:\n    :wq               Save and close",

  "s": ":[range]s/{pattern}/{replacement}/[flags]\n  Substitute {pattern} with {replacement} in [range].\n  Without a range, operates on the current line.\n  Use %s for the entire file.\n\n  Flags:\n    g   Replace all occurrences on each line (default: first only)\n    i   Case-insensitive matching\n\n  The delimiter can be any non-alphanumeric character.\n\n  Examples:\n    :s/foo/bar/         Replace first 'foo' on current line\n    :%s/foo/bar/g       Replace all 'foo' in file\n    :10,20s/old/new/g   Replace in lines 10-20\n    :%s#/usr#/opt#g     Use # as delimiter",

  "d": ":[range]d[elete] [register]\n  Delete [range] lines (default: current line).\n  Deleted text is stored in [register] (default: unnamed).\n\n  Examples:\n    :d                Delete current line\n    :5,10d            Delete lines 5-10\n    :%d               Delete all lines",

  "y": ":[range]y[ank] [register]\n  Yank (copy) [range] lines into [register].\n\n  Examples:\n    :y                Yank current line\n    :%y               Yank entire file",

  "p": ":p[ut] [register]\n  Put (paste) text from [register] after the current line.\n  :P or :pu! puts before the current line.\n\n  Example:\n    :p                Paste after current line",

  "print": ":[range]print [#]\n  Print [range] lines. Use # for line numbers.\n  Without a range, prints the current line.\n\n  Examples:\n    :%print           Print entire file\n    :%print #         Print entire file with line numbers\n    :10,20print       Print lines 10-20",

  "g": ":[range]g/{pattern}/{cmd}\n  Execute {cmd} on every line matching {pattern}.\n  :v is the inverse (lines NOT matching).\n\n  Examples:\n    :g/TODO/print     Print all lines containing TODO\n    :g/^$/d           Delete all blank lines\n    :v/keep/d         Delete lines not containing 'keep'",

  "v": ":[range]v/{pattern}/{cmd}\n  Execute {cmd} on every line NOT matching {pattern}.\n  Inverse of :g. See :help g for more.",

  "bn": ":bn[ext]\n  Switch to the next buffer.\n\n  Example:\n    :bn               Go to next buffer",

  "bp": ":bp[revious]\n  Switch to the previous buffer.\n\n  Example:\n    :bp               Go to previous buffer",

  "ls": ":ls / :buffers\n  List all open buffers with their numbers and status.\n\n  Example:\n    :ls               Show buffer list",

  "b": ":b {number|name}\n  Switch to buffer by number or name.\n\n  Example:\n    :b 2              Switch to buffer 2",

  "r": ":r[ead] {file}\n  Read {file} and insert its contents below the current line.\n\n  Example:\n    :r header.txt     Insert header.txt contents",

  "saveas": ":saveas {file}\n  Save the current buffer to {file} and switch to it.\n\n  Example:\n    :saveas copy.ts   Save as copy.ts",

  "find": ":fin[d] {file}\n  Search for {file} in the working directory tree and open it.\n\n  Example:\n    :find utils.ts    Find and open utils.ts",

  "grep": ":grep {pattern} [path] [glob]\n  Search for {pattern} in files under [path] (default: working dir).\n  Optionally filter by [glob] pattern.\n\n  Examples:\n    :grep TODO              Search for TODO in all files\n    :grep foo src *.ts      Search for foo in src/**/*.ts",

  "cd": ":cd {dir}\n  Change the working directory to {dir}.\n  Without arguments, changes to the home directory.\n\n  Examples:\n    :cd src           Change to src/\n    :cd               Change to home directory",

  "pwd": ":pwd\n  Print the current working directory.",

  "reg": ":reg[isters]\n  Display the contents of all registers.",

  "mark": ":ma[rk] {a-z}\n  Set mark {a-z} at the current line.\n  Jump to a mark with '{a-z} in normal mode.\n\n  Example:\n    :mark a           Set mark a",

  "norm": ":norm[al] {commands}\n  Execute normal-mode {commands} on each line in [range].\n\n  Example:\n    :%norm dd         Delete every line (one by one)",

  "!": ":[range]! {cmd}\n  Filter [range] lines through external shell {cmd}.\n  Without a range, just runs {cmd}.\n\n  Examples:\n    :%!sort           Sort entire file\n    :!ls              List directory contents",

  "insert": "Insert Mode Commands (entered from normal mode):\n  i   Enter insert mode at cursor\n  a   Enter insert mode after cursor\n  A   Enter insert mode at end of line\n  I   Enter insert mode at beginning of line\n  o   Open new line below and enter insert mode\n  O   Open new line above and enter insert mode\n  <Esc>  Return to normal mode",

  "normal": "Normal Mode Commands:\n  h/j/k/l     Move left/down/up/right\n  gg          Go to first line\n  G           Go to last line\n  0           Go to start of line\n  $           Go to end of line\n  dd          Delete current line\n  [count]dd   Delete [count] lines\n  yy          Yank (copy) current line\n  p           Put (paste) after cursor\n  P           Put (paste) before cursor\n  x           Delete character under cursor\n  ma          Set mark a\n  'a          Jump to mark a\n  \"ayy        Yank line into register a\n  \"ap         Put from register a\n  u           Undo",

  "range": "Range Formats:\n  (none)   Current line\n  %        Entire file\n  .        Current line (explicit)\n  $        Last line\n  N        Line N (e.g. 10)\n  N,M      Lines N through M (e.g. 10,20)\n  .,+N     Current line through N lines below\n  'a       Mark a\n  'a,'b    From mark a to mark b\n  /pat/    Next line matching pattern",
};

export class ExCommandHandler {
  constructor(
    private ctx: CommandContext,
    private onWorkingDirChange?: (dir: string) => void
  ) {}

  private helpCommand(topic?: string): string {
    if (!topic) {
      return [
        "Nimis Vim — Quick Reference",
        "═══════════════════════════",
        "",
        "File Operations:",
        "  :e {file}        Edit/open file          :w           Write (save)",
        "  :q               Quit buffer             :wq          Write and quit",
        "  :q!              Force quit               :saveas {f}  Save as new file",
        "  :r {file}        Read file into buffer   :find {file} Search & open file",
        "",
        "Navigation & Buffers:",
        "  :ls              List buffers             :b {n}       Switch to buffer",
        "  :bn / :bp        Next / previous buffer",
        "  :{number}        Jump to line number",
        "",
        "Editing:",
        "  :[range]s/p/r/g  Substitute               :[range]d    Delete lines",
        "  :[range]y        Yank lines               :p / :P      Put after/before",
        "  :g/pat/cmd       Global command           :v/pat/cmd   Inverse global",
        "  :[range]norm     Normal-mode on range     :[range]!    Shell filter",
        "",
        "Search & Directory:",
        "  :grep {pat}      Search in files          :pwd         Working directory",
        "  :cd {dir}        Change directory",
        "",
        "Info:",
        "  :reg             Show registers           :mark {a-z}  Set mark",
        "  :[range]print    Print lines              :[range]print # With numbers",
        "",
        "Normal Mode:  i/a/o  Enter insert    dd  Delete line    yy  Yank line",
        "              p/P    Put after/before  gg/G  Top/bottom   0/$  Start/end",
        "",
        "Type :help {topic} for detailed help.  Topics:",
        "  e w q wq s d y p print g v bn bp ls b r saveas find grep",
        "  cd pwd reg mark norm ! insert normal range",
      ].join("\n");
    }

    const key = topic.replace(/^:/, "");
    const entry = HELP_TOPICS[key];
    if (entry) {
      return entry;
    }

    const keys = Object.keys(HELP_TOPICS);
    const fuzzy = keys.filter(k => k.startsWith(key));
    if (fuzzy.length === 1) {
      return HELP_TOPICS[fuzzy[0]];
    }
    if (fuzzy.length > 1) {
      return `Multiple matches: ${fuzzy.join(", ")}\nTry :help {topic} with a more specific topic.`;
    }

    return `No help found for "${topic}".\nAvailable topics: ${keys.join(", ")}`;
  }

  private printLines(
    range: { start: number; end: number },
    buffer: VimBuffer,
    options?: { numbered?: boolean }
  ): string {
    const start = Math.max(0, Math.min(range.start, buffer.content.length - 1));
    const end = Math.max(start, Math.min(range.end, buffer.content.length - 1));

    const lines = buffer.content.slice(start, end + 1);

    if (options?.numbered) {
      return lines.map((line, i) => `${start + i + 1}\t${line}`).join("\n");
    }

    return lines.join("\n");
  }

  async execute(cmd: string, buffer: VimBuffer): Promise<string> {
    if (!cmd) {
      return "";
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
        if (rest === "p" || rest === "P") {
          return putLines(rest === "P", reg, buffer);
        }
        buffer.lastRegister = reg;
        if (rest) {
          return this.execute(rest, buffer);
        }
        return "";
      }
    }

    // %s/ substitution (supports escaped delimiters, e.g. %s/\/usr\/local/\/opt/g)
    const percentSubMatch = cmd.match(/^%s([^a-zA-Z0-9\s])(.*)$/s);
    if (percentSubMatch) {
      const [_, delim, rest] = percentSubMatch;
      const parsed = parseSubstituteArgs(rest, delim);
      if (parsed) {
        return substituteWithPattern(
          { start: 0, end: buffer.content.length - 1 },
          parsed.pattern,
          parsed.replacement,
          parsed.flags,
          buffer
        );
      }
      throw new Error(
        "Invalid substitute format. Use :%s/pattern/replacement/flags"
      );
    }

    // Range-based substitution (e.g. 10,20s/old/new/g)
    const rangeSubMatch = cmd.match(/^(\d+,\d+)s([^a-zA-Z0-9\s])(.*)$/s);
    if (rangeSubMatch) {
      const [_, rangeStr, delim, rest] = rangeSubMatch;
      const parsed = parseSubstituteArgs(rest, delim);
      if (parsed) {
        try {
          const range = parseRange(rangeStr, buffer);
          return substituteWithPattern(
            range,
            parsed.pattern,
            parsed.replacement,
            parsed.flags,
            buffer
          );
        } catch (e) {
          throw new Error(`Invalid range: ${rangeStr}`);
        }
      }
    }

    // Simple substitution on current line (e.g. s/old/new/g)
    // Delimiter must be non-alphanumeric to avoid matching "saveas", "set", etc.
    const simpleSubMatch = cmd.match(/^s([^a-zA-Z0-9\s])(.*)$/s);
    if (simpleSubMatch) {
      const [_, delim, rest] = simpleSubMatch;
      const parsed = parseSubstituteArgs(rest, delim);
      if (parsed) {
        return substituteWithPattern(
          { start: buffer.currentLine, end: buffer.currentLine },
          parsed.pattern,
          parsed.replacement,
          parsed.flags,
          buffer
        );
      }
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
          if (regex1.test(buffer.content[i])) {
            startLine = i;
            break;
          }
        }
        if (startLine === -1) {
          for (let i = 0; i < buffer.currentLine; i++) {
            if (regex1.test(buffer.content[i])) {
              startLine = i;
              break;
            }
          }
        }
        if (startLine === -1) throw new Error(`Pattern not found: ${pat1Str}`);

        let endLine = -1;
        for (let i = startLine; i < buffer.content.length; i++) {
          if (regex2.test(buffer.content[i])) {
            endLine = i;
            break;
          }
        }
        if (endLine === -1) throw new Error(`Pattern not found: ${pat2Str}`);

        range = { start: startLine, end: endLine };
        rest = restOfCmd.trim();
      } catch (e: any) {
        if (e.message?.includes("Pattern not found")) throw e;
        rest = cmd;
      }
    }

    // Single search pattern range: /pattern/command or standalone /pattern/ (jump to line)
    if (!range) {
      const singlePatternMatch = cmd.match(/^(\/[^/]+\/)(.*)$/);
      if (singlePatternMatch) {
        try {
          range = parseRange(singlePatternMatch[1], buffer);
          rest = singlePatternMatch[2].trim();
          // Standalone /pattern/ with no command: jump to line (Vim behavior)
          if (rest === "") {
            buffer.currentLine = range.start;
            return `Jumped to line ${range.start + 1}`;
          }
        } catch (e: any) {
          // Pattern not found: do nothing (no-op), don't fall through to generic range parsing
          if (e?.message?.includes?.("Pattern not found")) {
            return "";
          }
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

    // Bare line number (e.g. :15) or range with no command: go to line
    if (range && rest === "") {
      buffer.currentLine = range.start;
      return `Jumped to line ${range.start + 1}`;
    }

    // Handle substitution after range extraction (e.g. /pattern/s/old/new/g)
    const rangeSubCmdMatch = rest.match(/^s([^a-zA-Z0-9\s])(.*)$/s);
    if (rangeSubCmdMatch) {
      const [_, delim, subRest] = rangeSubCmdMatch;
      const parsed = parseSubstituteArgs(subRest, delim);
      if (parsed) {
        return substituteWithPattern(
          range || { start: buffer.currentLine, end: buffer.currentLine },
          parsed.pattern,
          parsed.replacement,
          parsed.flags,
          buffer
        );
      }
    }

    // Handle g/pattern/cmd and v/pattern/cmd without space separator
    const globalMatch = rest.match(/^(g|v)(\/[^/]+\/.*)$/);
    if (globalMatch) {
      const [_, gv, gargs] = globalMatch;
      return await globalCommand(gargs, gv === "v", buffer);
    }

    // Handle external command (! prefix) before splitting on whitespace,
    // since the shell command after ! may not have a space separator (e.g. %!sort)
    if (rest.startsWith("!")) {
      return await externalCommand(
        range,
        rest.substring(1).trim() || undefined,
        buffer
      );
    }

    const cmdParts = rest.split(/\s+/);
    const cmdName = cmdParts[0];
    const args = cmdParts.slice(1).join(" ");

    switch (cmdName) {
      case "cd":
      case "chdir": // Alias for cd
        // Handle empty args (cd without args goes to home)
        if (!args || args.trim() === "") {
          const homedir = require("os").homedir();

          // Notify the manager about the change
          if (this.onWorkingDirChange) {
            this.onWorkingDirChange(homedir);
          }

          return `Changed directory to ${homedir}`;
        }

        // Parse the path (handle quoted paths with spaces)
        let targetPath = args.trim();

        // Remove quotes if present
        if (
          (targetPath.startsWith('"') && targetPath.endsWith('"')) ||
          (targetPath.startsWith("'") && targetPath.endsWith("'"))
        ) {
          targetPath = targetPath.substring(1, targetPath.length - 1);
        } else {
          // If multiple args, take only the first one (Vim behavior)
          const spaceIndex = targetPath.indexOf(" ");
          if (spaceIndex > 0) {
            targetPath = targetPath.substring(0, spaceIndex);
          }
        }
        try {
          // Resolve the path relative to current working directory
          const resolvedPath = this.ctx.resolvePath(targetPath);

          // Check if the path exists and is a directory
          const fs = require("fs");
          if (!fs.existsSync(resolvedPath)) {
            throw new Error(`Directory not found: ${args.split(" ")[0]}`);
          }

          const stats = fs.statSync(resolvedPath);
          if (!stats.isDirectory()) {
            throw new Error(`Directory not found: ${args.split(" ")[0]}`);
          }

          // Notify the manager about the change
          if (this.onWorkingDirChange) {
            this.onWorkingDirChange(resolvedPath);
          }

          return `Changed directory to ${resolvedPath}`;
        } catch (error: any) {
          if (error.message.includes("Directory not found")) {
            throw error;
          }
          throw new Error(`Failed to change directory: ${error.message}`);
        }

      case "pwd":
        if (this.ctx.workingDir) {
          return this.ctx.workingDir;
        }
        // Fallback to current process directory
        return process.cwd();
      case "e":
        if (!args) throw new Error(":e requires a filename");

        // Handle directory listing
        if (args === "." || args === "./" || args === ".\\") {
          const currentDir = this.ctx.workingDir || process.cwd();
          return await listDirectory(currentDir, this.ctx);
        }

        // Check if it's a directory path
        const resolvedPath = this.ctx.resolvePath(args);
        try {
          const stats = await fs.promises.stat(resolvedPath);
          if (stats.isDirectory()) {
            return await listDirectory(resolvedPath, this.ctx);
          }
        } catch (e) {
          // File doesn't exist - proceed with normal edit
        }

        if (!args) throw new Error(":e requires a filename");
        await editFile(args, this.ctx);
        return `Editing ${path.basename(args)}`;

      case "find":
      case "fin": {
        if (!args || !args.trim()) throw new Error(":find requires a filename");
        const findArg = args.trim();
        // First try resolving as-is (like :e)
        try {
          const resolved = this.ctx.resolvePath(findArg);
          const stats = await fs.promises.stat(resolved);
          if (stats.isFile()) {
            await editFile(findArg, this.ctx);
            return `Editing ${path.basename(findArg)}`;
          }
        } catch {
          // Not found or not a file — search in path
        }
        // Search under working dir (path-like: current dir and **)
        const baseDir = this.ctx.workingDir || path.dirname(buffer.path) || process.cwd();
        const normalizedArg = findArg.replace(/\//g, path.sep);
        const found = await findFileInPath(baseDir, normalizedArg);
        if (found) {
          await editFile(found, this.ctx);
          return `Editing ${path.basename(found)}`;
        }
        throw new Error(`Can't find file "${findArg}" in path`);
      }

      case "grep": {
        if (!args || !args.trim()) throw new Error(":grep requires a pattern");
        const rest = args.trim();
        const parts = rest.split(/\s+/);
        const pattern = parts[0];
        const baseDir = this.ctx.workingDir || (buffer ? path.dirname(buffer.path) : undefined) || process.cwd();
        let searchDir = baseDir;
        let filePattern: string | undefined;
        if (parts.length >= 2) {
          const second = parts[1];
          try {
            const resolved = this.ctx.resolvePath(second);
            const stats = await fs.promises.stat(resolved);
            if (stats.isDirectory()) {
              searchDir = resolved;
              filePattern = parts[2];
            } else {
              filePattern = second;
            }
          } catch {
            filePattern = second;
          }
        }
        const { text, isError } = await grepInDirectory(pattern, searchDir, filePattern);
        if (isError) throw new Error(text);
        return text;
      }

      case "w":
        await writeBuffer(buffer);
        return `"${path.basename(buffer.path)}" ${buffer.content.length}L written`;

      case "q":
        if (buffer.modified)
          throw new Error("No write since last change (use :q! to force quit)");
        this.ctx.buffers.delete(buffer.path);
        this.ctx.setCurrentBuffer(getNextBuffer(this.ctx.buffers, null));
        return `Closed ${path.basename(buffer.path)}`;

      case "wq":
        await writeBuffer(buffer);
        this.ctx.buffers.delete(buffer.path);
        this.ctx.setCurrentBuffer(getNextBuffer(this.ctx.buffers, null));
        return `"${path.basename(buffer.path)}" written and closed`;

      case "q!":
        this.ctx.buffers.delete(buffer.path);
        this.ctx.setCurrentBuffer(getNextBuffer(this.ctx.buffers, null));
        return `Closed ${path.basename(buffer.path)} (changes discarded)`;

      case "bn":
      case "bnext": {
        const next = getNextBuffer(
          this.ctx.buffers,
          this.ctx.getCurrentBuffer()
        );
        this.ctx.setCurrentBuffer(next);
        return `Editing ${path.basename(next?.path || "")}`;
      }

      case "bp":
      case "bprevious": {
        const prev = getPreviousBuffer(
          this.ctx.buffers,
          this.ctx.getCurrentBuffer()
        );
        this.ctx.setCurrentBuffer(prev);
        return `Editing ${path.basename(prev?.path || "")}`;
      }

      case "ls":
      case "buffers":
        return formatBufferList(this.ctx.buffers, this.ctx.getCurrentBuffer());

      case "b":
        if (!args) throw new Error(":b requires buffer number or name");
        this.ctx.setCurrentBuffer(await switchToBuffer(args, this.ctx.buffers));
        return `Editing ${path.basename(this.ctx.getCurrentBuffer()?.path || "")}`;

      case "r":
        if (!args) throw new Error(":r requires a filename");
        return await readFileIntoBuffer(args, buffer);

      case "saveas":
        if (!args) throw new Error(":saveas requires a filename");
        return await saveAs(args, buffer, this.ctx.buffers);

      case "reg":
      case "registers":
        return formatRegisters(buffer);

      case "ma":
      case "mark":
        return setMark(args, buffer);

      case "d":
      case "de":
      case "del":
      case "dele":
      case "delet":
      case "delete":
        return deleteLines(
          range || { start: buffer.currentLine, end: buffer.currentLine },
          args || undefined,
          buffer
        );

      case "y":
        return yankLines(
          range || { start: buffer.currentLine, end: buffer.currentLine },
          args || undefined,
          buffer
        );

      case "print":
        const showNumbers = args === "#" || args === "number";
        return this.printLines(
          range || { start: buffer.currentLine, end: buffer.currentLine },
          buffer,
          { numbered: showNumbers }
        );

      case "p":
      case "pu":
        return putLines(
          false,
          args || buffer.lastRegister || undefined,
          buffer
        );

      case "pu!":
        return putLines(true, args || buffer.lastRegister || undefined, buffer);

      case "P":
        return putLines(true, args || buffer.lastRegister || undefined, buffer);

      case "g":
        return await globalCommand(args, false, buffer);

      case "v":
        return await globalCommand(args, true, buffer);

      case "norm":
      case "normal":
        return normalExCommand(range, args, buffer);

      case "!":
        return await externalCommand(range, args, buffer);

      case "h":
      case "he":
      case "hel":
      case "help":
        return this.helpCommand(args?.trim() || undefined);

      default:
        throw new Error(`Unsupported Ex command: ${cmdName}`);
    }
  }
}
