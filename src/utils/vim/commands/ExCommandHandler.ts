// src/commands/ExCommandHandler.ts
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type { VimBuffer, CommandContext, VimOptions } from "../types";
import { VIM_OPTION_ALIASES, VIM_BOOLEAN_OPTIONS, VIM_OPTION_DEFAULTS } from "../types";
import { parseRange } from "../utils/RangeParser";
import {
  substituteWithPattern,
  deleteLines,
  changeLines,
  yankLines,
  putLines,
  globalCommand,
  normalExCommand,
  setMark,
  vimPatternToJs,
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
import { loadBufferFromFile } from "../models/VimBuffer";
import { listDirectory } from "../operations/DirectoryOperations";
import { grepInDirectory } from "../operations/GrepOperations";
import { createTwoFilesPatch } from "diff";

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
  "e": ":e[dit] {file}\n  Open {file} for editing. Creates a new buffer if the file doesn't exist.\n  If {file} is a directory, lists its contents.\n  :e! reloads the current file from disk, discarding unsaved changes.\n  :e! {file} opens {file}, discarding unsaved changes to the current buffer.\n\n  Examples:\n    :e main.ts        Open main.ts\n    :e .              List current directory\n    :e!               Reload current file from disk\n    :e! main.ts       Open main.ts, discard current changes",

  "w": ":w[rite]\n  Write the current buffer to disk.\n\n  Example:\n    :w                Save current file",

  "q": ":q[uit]\n  Close the current buffer. Fails if there are unsaved changes.\n  Use :q! to force-close and discard changes.\n\n  Examples:\n    :q                Close buffer\n    :q!               Force close, discard changes",

  "wq": ":wq\n  Write current buffer to disk and close it.\n\n  Example:\n    :wq               Save and close",

  "s": ":[range]s/{pattern}/{replacement}/[flags]\n  Substitute {pattern} with {replacement} in [range].\n  Without a range, operates on the current line.\n  Use %s for the entire file.\n\n  Flags:\n    g   Replace all occurrences on each line (default: first only)\n    i   Case-insensitive matching\n\n  The delimiter can be any non-alphanumeric character.\n\n  Examples:\n    :s/foo/bar/         Replace first 'foo' on current line\n    :%s/foo/bar/g       Replace all 'foo' in file\n    :10,20s/old/new/g   Replace in lines 10-20\n    :%s#/usr#/opt#g     Use # as delimiter",

  "c": ":[range]c[hange]\\{text}\n  Delete [range] lines and replace with {text}.\n  Use \\n in {text} for newlines. Deleted text is stored in the unnamed register.\n\n  Forms:\n    :[range]c\\{text}   Inline replacement (backslash before text)\n    :[range]c {text}   Space-separated replacement\n\n  Examples:\n    :5c\\new line       Replace line 5 with 'new line'\n    :5,10c\\line1\\nline2  Replace lines 5-10 with two lines\n    :%c\\replaced       Replace entire file with one line",

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

  "terminal": ":ter[minal] [cmd]\n  Open a VS Code terminal. With [cmd], runs the command in the new terminal.\n  Uses the current working directory.\n\n  Examples:\n    :terminal         Open new terminal\n    :terminal npm run dev   Run command in terminal",

  "termal": "Alias for :terminal. Open a VS Code terminal.",

  "retab": ":[range]ret[ab][!] [new_tabstop]\n  Replace whitespace using the current or new tabstop value.\n\n  Without [new_tabstop]:\n    With 'expandtab' on: converts tabs to spaces.\n    With 'expandtab' off: keeps tabs. With [!]: converts spaces to tabs.\n\n  With [new_tabstop]:\n    Re-indents the file: interprets leading whitespace using the OLD\n    tabstop, then rebuilds it using [new_tabstop]. This changes\n    indentation width (e.g. 2-space → 4-space).\n    Set 'tabstop' to match current indentation first for best results.\n\n  Without a range, the entire file is retabbed.\n\n  Examples:\n    :retab              Convert tabs to spaces (expandtab on)\n    :set tabstop=2\n    :retab 4            Re-indent from 2-space to 4-space\n    :retab!             Convert space sequences to tabs (noexpandtab)\n    :10,20retab 2       Re-indent lines 10-20",

  "diff": ":dif[f] [file1] [file2]\n  Show unified diff between two files, or between current buffer and a file.\n\n  With two arguments: compare file1 (old) vs file2 (new).\n  With one argument: compare [file] on disk (old) vs current buffer (new).\n  Useful to see unsaved changes.\n\n  Examples:\n    :diff a.ts b.ts     Diff between two files\n    :diff src/main.ts   Diff buffer vs disk (show unsaved changes)",

  "set": ":se[t] [{option}[={value}] ...]\n  Show or change editor options.\n\n  Boolean options:\n    :set expandtab      Enable option\n    :set noexpandtab    Disable option\n    :set invexpandtab   Toggle option\n\n  Numeric options:\n    :set tabstop=4      Set value\n    :set tabstop?       Query current value\n    :set tabstop&       Reset to default\n\n  Multiple options at once:\n    :set expandtab tabstop=4 shiftwidth=4\n\n  Show all options:\n    :set                Show all current values\n    :set all            Show all current values\n\n  Available options (aliases):\n    expandtab (et)      Use spaces instead of tabs\n    tabstop (ts)        Number of spaces a tab counts for\n    softtabstop (sts)   Number of spaces for Tab/Backspace\n    shiftwidth (sw)     Number of spaces for indent\n    autoindent (ai)     Copy indent from current line\n    number (nu)         Show line numbers\n    relativenumber (rnu) Show relative line numbers\n    wrapscan (ws)       Searches wrap around end of file\n    ignorecase (ic)     Ignore case in search\n    smartcase (scs)     Override ignorecase if pattern has uppercase\n    hlsearch (hls)      Highlight search matches",

  "setlocal": ":setl[ocal] [{option}[={value}] ...]\n  Same as :set. Set options for the current buffer.\n  In Nimis, options are shared across buffers, so :setlocal behaves like :set.",

  "insert": "Insert Mode Commands (entered from normal mode):\n  i   Enter insert mode at cursor\n  a   Enter insert mode after cursor\n  A   Enter insert mode at end of line\n  I   Enter insert mode at beginning of line\n  o   Open new line below and enter insert mode\n  O   Open new line above and enter insert mode\n  <Esc>  Return to normal mode",

  "normal": "Normal Mode Commands:\n  h/j/k/l     Move left/down/up/right\n  gg          Go to first line\n  G           Go to last line\n  0           Go to start of line\n  $           Go to end of line\n  Ctrl+f      Page down (24 lines)\n  Ctrl+b      Page up (24 lines)\n  Ctrl+d      Half page down (12 lines)\n  Ctrl+u      Half page up (12 lines)\n  zt          Scroll current line to top of viewport\n  zz          Scroll current line to middle of viewport\n  zb          Scroll current line to bottom of viewport\n  dd          Delete current line\n  [count]dd   Delete [count] lines\n  yy          Yank (copy) current line\n  p           Put (paste) after cursor\n  P           Put (paste) before cursor\n  >>          Indent line right (shiftwidth)\n  <<          Indent line left (shiftwidth)\n  [count]>>   Indent [count] lines right\n  x           Delete character under cursor\n  ma          Set mark a\n  'a          Jump to mark a\n  \"ayy        Yank line into register a\n  \"ap         Put from register a\n  u           Undo",

  "range": "Range Formats:\n  (none)   Current line\n  %        Entire file\n  .        Current line (explicit)\n  $        Last line\n  N        Line N (e.g. 10)\n  N,M      Lines N through M (e.g. 10,20)\n  +N       N lines below current (e.g. :+2,+2print)\n  -N       N lines above current\n  .,+N     Current line through N lines below\n  'a       Mark a\n  'a,'b    From mark a to mark b\n  /pat/    Next line matching pattern",
};

export class ExCommandHandler {
  constructor(
    private ctx: CommandContext,
    private onWorkingDirChange?: (dir: string) => void
  ) {}

  /** Find the GCD of all non-zero indentation widths in the range. */
  static detectIndentUnit(
    content: string[],
    range: { start: number; end: number },
    tabstop: number
  ): number {
    const widths: number[] = [];
    for (let i = range.start; i <= range.end && i < content.length; i++) {
      const line = content[i];
      if (line.trim() === "") continue;
      let col = 0;
      for (const ch of line) {
        if (ch === " ") col++;
        else if (ch === "\t") col += tabstop - (col % tabstop);
        else break;
      }
      if (col > 0) widths.push(col);
    }
    if (widths.length === 0) return tabstop;
    let g = widths[0];
    for (let i = 1; i < widths.length; i++) {
      let a = g, b = widths[i];
      while (b) { [a, b] = [b, a % b]; }
      g = a;
      if (g === 1) return 1;
    }
    return g;
  }

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
        "  :[range]s/p/r/g  Substitute               :[range]c    Change lines",
        "  :[range]d        Delete lines",
        "  :[range]y        Yank lines               :p / :P      Put after/before",
        "  :g/pat/cmd       Global command           :v/pat/cmd   Inverse global",
        "  :[range]norm     Normal-mode on range     :[range]!    Shell filter",
        "",
        "Search & Directory:",
        "  :grep {pat}      Search in files          :pwd         Working directory",
        "  :cd {dir}        Change directory",
        "",
        "Diff:",
        "  :diff {f1} {f2}  Compare two files        :diff {f}    Buffer vs file on disk",
        "",
        "Settings & Info:",
        "  :set {opt}[=val] Set option               :set         Show all options",
        "  :retab [N]       Retab with tabstop        :retab!      Also convert spaces",
        "  :reg             Show registers           :mark {a-z}  Set mark",
        "  :[range]print    Print lines              :[range]print # With numbers",
        "",
        "Normal Mode:  i/a/o  Enter insert    dd  Delete line    yy  Yank line",
        "              p/P    Put after/before  gg/G  Top/bottom   0/$  Start/end",
        "",
        "Type :help {topic} for detailed help.  Topics:",
        "  e w q wq s c d y p print g v bn bp ls b r saveas find grep diff",
        "  cd pwd reg mark norm ! terminal termal set setlocal retab insert normal range",
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

  private resolveOptionName(name: string): keyof VimOptions | null {
    if (name in VIM_OPTION_DEFAULTS) return name as keyof VimOptions;
    if (name in VIM_OPTION_ALIASES) return VIM_OPTION_ALIASES[name];
    return null;
  }

  private setCommand(args: string): string {
    const opts = this.ctx.options;

    if (!args || args === 'all') {
      const lines: string[] = [];
      for (const [key, value] of Object.entries(opts)) {
        if (VIM_BOOLEAN_OPTIONS.has(key as keyof VimOptions)) {
          lines.push(value ? `  ${key}` : `  no${key}`);
        } else {
          lines.push(`  ${key}=${value}`);
        }
      }
      return lines.join('\n');
    }

    const tokens = args.split(/\s+/);
    const results: string[] = [];

    for (const token of tokens) {
      const queryMatch = token.match(/^(\w+)\?$/);
      if (queryMatch) {
        const key = this.resolveOptionName(queryMatch[1]);
        if (!key) throw new Error(`Unknown option: ${queryMatch[1]}`);
        const val = opts[key];
        if (VIM_BOOLEAN_OPTIONS.has(key)) {
          results.push(val ? `  ${key}` : `  no${key}`);
        } else {
          results.push(`  ${key}=${val}`);
        }
        continue;
      }

      const resetMatch = token.match(/^(\w+)&$/);
      if (resetMatch) {
        const key = this.resolveOptionName(resetMatch[1]);
        if (!key) throw new Error(`Unknown option: ${resetMatch[1]}`);
        (opts as any)[key] = VIM_OPTION_DEFAULTS[key];
        continue;
      }

      const assignMatch = token.match(/^(\w+)[:=](\S+)$/);
      if (assignMatch) {
        const key = this.resolveOptionName(assignMatch[1]);
        if (!key) throw new Error(`Unknown option: ${assignMatch[1]}`);
        if (VIM_BOOLEAN_OPTIONS.has(key)) {
          throw new Error(`Invalid argument: ${token} (use :set ${key} or :set no${key})`);
        }
        const num = parseInt(assignMatch[2], 10);
        if (isNaN(num)) throw new Error(`Number required after =: ${token}`);
        (opts as any)[key] = num;
        continue;
      }

      if (token.startsWith('no')) {
        const key = this.resolveOptionName(token.slice(2));
        if (key && VIM_BOOLEAN_OPTIONS.has(key)) {
          (opts as any)[key] = false;
          continue;
        }
      }

      if (token.startsWith('inv')) {
        const key = this.resolveOptionName(token.slice(3));
        if (key && VIM_BOOLEAN_OPTIONS.has(key)) {
          (opts as any)[key] = !opts[key];
          continue;
        }
      }

      const key = this.resolveOptionName(token);
      if (key) {
        if (VIM_BOOLEAN_OPTIONS.has(key)) {
          (opts as any)[key] = true;
        } else {
          results.push(`  ${key}=${opts[key]}`);
        }
        continue;
      }

      throw new Error(`Unknown option: ${token}`);
    }

    return results.join('\n');
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
        const regex1 = new RegExp(vimPatternToJs(pat1Str.slice(1, -1)));
        const regex2 = new RegExp(vimPatternToJs(pat2Str.slice(1, -1)));

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
        for (let i = startLine + 1; i < buffer.content.length; i++) {
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
          if (e?.message?.includes?.("Pattern not found")) {
            return "";
          }
          if (e?.message?.includes?.("Invalid pattern")) {
            throw e;
          }
          rest = cmd;
        }
      }
    }

    // Single search pattern without closing slash: /pattern (Vim accepts :/pattern without trailing /)
    if (!range) {
      const singlePatternNoCloseMatch = cmd.match(/^\/(.+)$/);
      if (singlePatternNoCloseMatch) {
        const pattern = singlePatternNoCloseMatch[1];
        try {
          range = parseRange("/" + pattern + "/", buffer);
          buffer.currentLine = range.start;
          return `Jumped to line ${range.start + 1}`;
        } catch (e: any) {
          if (e?.message?.includes?.("Pattern not found")) {
            return "";
          }
          throw e;
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

    // Handle change command with inline text: c\text (backslash means text follows)
    const changeInlineMatch = rest.match(/^c(?:hange)?\\(.*)$/s);
    if (changeInlineMatch) {
      const rawText = changeInlineMatch[1];
      const replacementText = rawText.replace(/\\n/g, "\n");
      return changeLines(
        range || { start: buffer.currentLine, end: buffer.currentLine },
        replacementText,
        undefined,
        buffer
      );
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

      case "e!": {
        // :e! — reload current file from disk, discarding changes
        // :e! filename — open file, discarding unsaved changes to current buffer
        const editTarget = args?.trim();
        if (!editTarget) {
          // Reload current buffer from disk
          const reloadPath = buffer.path;
          const reloaded = await loadBufferFromFile(reloadPath);
          this.ctx.buffers.set(reloadPath, reloaded);
          this.ctx.setCurrentBuffer(reloaded);
          return `"${path.basename(reloadPath)}" ${reloaded.content.length}L`;
        }
        // Open a different file, discarding current changes
        buffer.modified = false;
        const bangResolved = this.ctx.resolvePath(editTarget);
        this.ctx.buffers.delete(bangResolved);
        await editFile(editTarget, this.ctx);
        return `Editing ${path.basename(editTarget)}`;
      }

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

      case "zt":
        buffer.viewportTop = buffer.currentLine;
        return "Scrolled to top";

      case "ctrl-f":
      case "ctrl-b":
      case "ctrl-d":
      case "ctrl-u": {
        const VIM_ROWS = 24;
        const totalLines = buffer.content.length;
        const maxViewportTop = Math.max(0, totalLines - VIM_ROWS);
        const halfPage = Math.floor(VIM_ROWS / 2);
        let delta: number;
        switch (cmdName) {
          case "ctrl-f": delta = VIM_ROWS; break;
          case "ctrl-b": delta = -VIM_ROWS; break;
          case "ctrl-d": delta = halfPage; break;
          case "ctrl-u": delta = -halfPage; break;
          default: return "";
        }
        const base = buffer.viewportTop ?? buffer.currentLine;
        buffer.viewportTop = Math.max(0, Math.min(maxViewportTop, base + delta));
        buffer.currentLine = Math.max(0, Math.min(totalLines - 1, buffer.currentLine + delta));
        const action = cmdName === "ctrl-f" ? "Page down" : cmdName === "ctrl-b" ? "Page up" : cmdName === "ctrl-d" ? "Half page down" : "Half page up";
        return action;
      }

      case "zz": {
        const VIM_ROWS = 24;
        buffer.viewportTop = Math.max(0, buffer.currentLine - Math.floor(VIM_ROWS / 2));
        return "Scrolled to center";
      }

      case "zb": {
        const VIM_ROWS = 24;
        buffer.viewportTop = Math.max(0, buffer.currentLine - (VIM_ROWS - 1));
        return "Scrolled to bottom";
      }

      case "ma":
      case "mark":
        return setMark(args, buffer);

      case "c":
      case "ch":
      case "cha":
      case "chan":
      case "chang":
      case "change": {
        if (!args) {
          return deleteLines(
            range || { start: buffer.currentLine, end: buffer.currentLine },
            undefined,
            buffer
          );
        }
        const replacementText = args.replace(/\\n/g, "\n");
        return changeLines(
          range || { start: buffer.currentLine, end: buffer.currentLine },
          replacementText,
          undefined,
          buffer
        );
      }

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
        return normalExCommand(range, args, buffer, this.ctx.options);

      case "!":
        return await externalCommand(range, args, buffer);

      case "terminal":
      case "term":
      case "termal": {
        const cwd = this.ctx.workingDir || (buffer ? path.dirname(buffer.path) : undefined);
        const term = vscode.window.createTerminal({
          cwd: cwd || undefined,
          name: "Vim :terminal",
        });
        term.show();
        if (args && args.trim()) {
          term.sendText(args.trim());
        }
        return `Opened terminal${args?.trim() ? `: ${args.trim()}` : ""}`;
      }

      case "retab":
      case "ret":
      case "retab!":
      case "ret!": {
        const bang = cmdName.endsWith("!");
        const effectiveRange = range || {
          start: 0,
          end: buffer.content.length - 1,
        };
        const newTabstop = args?.trim()
          ? parseInt(args.trim(), 10)
          : undefined;
        if (newTabstop !== undefined) {
          if (isNaN(newTabstop) || newTabstop < 1)
            throw new Error("Invalid argument for :retab");
        }

        const currentTs = this.ctx.options.tabstop;
        const newTs = newTabstop ?? currentTs;
        const useSpaces = this.ctx.options.expandtab;
        // When user provides :retab N or :retab! N, always re-indent (auto-detect file's indent unit).
        // Previously we required newTabstop !== currentTs, which broke :set tabstop=4 + :retab! 4.
        const reindent = newTabstop !== undefined;

        if (newTabstop !== undefined) {
          (this.ctx.options as any).tabstop = newTabstop;
        }

        let changed = 0;

        if (reindent) {
          // Auto-detect the file's indentation unit so :retab N just works
          const detectedUnit = ExCommandHandler.detectIndentUnit(
            buffer.content,
            effectiveRange,
            currentTs
          );

          for (
            let i = effectiveRange.start;
            i <= effectiveRange.end && i < buffer.content.length;
            i++
          ) {
            const original = buffer.content[i];

            let leadingCols = 0;
            let j = 0;
            while (
              j < original.length &&
              (original[j] === " " || original[j] === "\t")
            ) {
              if (original[j] === "\t") {
                leadingCols += currentTs - (leadingCols % currentTs);
              } else {
                leadingCols++;
              }
              j++;
            }

            const indentLevels = Math.floor(leadingCols / detectedUnit);
            const remainder = leadingCols % detectedUnit;

            let newLeading: string;
            if (useSpaces) {
              newLeading = " ".repeat(indentLevels * newTs + remainder);
            } else {
              newLeading =
                "\t".repeat(indentLevels) + " ".repeat(remainder);
            }

            let rest = "";
            let col = indentLevels * newTs + remainder;
            for (let k = j; k < original.length; k++) {
              if (original[k] === "\t") {
                const spacesToNext = newTs - (col % newTs);
                if (useSpaces) {
                  rest += " ".repeat(spacesToNext);
                } else {
                  rest += "\t";
                }
                col += spacesToNext;
              } else {
                rest += original[k];
                col++;
              }
            }

            const result = newLeading + rest;
            if (result !== original) {
              buffer.content[i] = result;
              changed++;
            }
          }
        } else {
          for (
            let i = effectiveRange.start;
            i <= effectiveRange.end && i < buffer.content.length;
            i++
          ) {
            const original = buffer.content[i];
            let result = "";
            let col = 0;

            for (let j = 0; j < original.length; j++) {
              const ch = original[j];
              if (ch === "\t") {
                const spacesToNext = newTs - (col % newTs);
                if (useSpaces) {
                  result += " ".repeat(spacesToNext);
                } else {
                  result += "\t";
                }
                col += spacesToNext;
              } else if (ch === " " && bang && !useSpaces) {
                let spaceCount = 1;
                while (
                  j + spaceCount < original.length &&
                  original[j + spaceCount] === " "
                ) {
                  spaceCount++;
                }
                const endCol = col + spaceCount;
                const startTab = Math.ceil(col / newTs) * newTs;
                let pos = col;
                let replacement = "";
                if (startTab <= endCol) {
                  replacement += " ".repeat(startTab - pos);
                  pos = startTab;
                  while (pos + newTs <= endCol) {
                    replacement += "\t";
                    pos += newTs;
                  }
                  replacement += " ".repeat(endCol - pos);
                } else {
                  replacement += " ".repeat(spaceCount);
                }
                result += replacement;
                col = endCol;
                j += spaceCount - 1;
              } else {
                result += ch;
                col++;
              }
            }

            if (result !== original) {
              buffer.content[i] = result;
              changed++;
            }
          }
        }

        if (changed > 0) buffer.modified = true;
        const lineCount =
          effectiveRange.end - effectiveRange.start + 1;
        return changed > 0
          ? `${changed} line${changed !== 1 ? "s" : ""} changed`
          : `${lineCount} line${lineCount !== 1 ? "s" : ""} unchanged`;
      }

      case "se":
      case "set":
      case "setlocal":
      case "setl":
        return this.setCommand(args?.trim() || '');

      case "diff":
      case "dif": {
        const parts = args?.trim().split(/\s+/)?.filter(Boolean) ?? [];
        if (parts.length === 0) {
          throw new Error(":diff requires one or two file arguments");
        }
        const cwd = this.ctx.workingDir || process.cwd();
        const toContent = (p: string) => {
          const resolved = path.isAbsolute(p) ? p : path.resolve(cwd, p);
          return fs.readFileSync(resolved, "utf-8");
        };
        let oldLabel: string;
        let oldStr: string;
        let newLabel: string;
        let newStr: string;
        if (parts.length === 1) {
          const filePath = this.ctx.resolvePath(parts[0]);
          oldLabel = path.relative(cwd, filePath) || filePath;
          newLabel = buffer.path ? path.relative(cwd, buffer.path) || buffer.path : "buffer";
          try {
            oldStr = fs.readFileSync(filePath, "utf-8");
          } catch (e: any) {
            throw new Error(`Cannot read ${parts[0]}: ${e.message}`);
          }
          newStr = buffer.content.join(buffer.lineEnding || "\n");
          if (buffer.trailingNewline !== false) {
            newStr += buffer.lineEnding || "\n";
          }
        } else {
          const p1 = this.ctx.resolvePath(parts[0]);
          const p2 = this.ctx.resolvePath(parts[1]);
          oldLabel = path.relative(cwd, p1) || p1;
          newLabel = path.relative(cwd, p2) || p2;
          try {
            oldStr = fs.readFileSync(p1, "utf-8");
          } catch (e: any) {
            throw new Error(`Cannot read ${parts[0]}: ${e.message}`);
          }
          try {
            newStr = fs.readFileSync(p2, "utf-8");
          } catch (e: any) {
            throw new Error(`Cannot read ${parts[1]}: ${e.message}`);
          }
        }
        const patch = createTwoFilesPatch(oldLabel, newLabel, oldStr, newStr);
        return (!patch || !patch.includes("@@")) ? "(no differences)" : patch;
      }

      case "h":
      case "he":
      case "hel":
      case "help":
        return this.helpCommand(args?.trim() || undefined);

      default: {
        // Map common normal-mode commands to Ex equivalents when used after a range/address
        const normalToEx: Record<string, string> = { dd: "d", yy: "y" };
        if (range && normalToEx[rest]) {
          return this.execute(
            `${range.start + 1},${range.end + 1}${normalToEx[rest]}`,
            buffer
          );
        }
        // Fall back to :normal for other unrecognized commands that follow a range
        if (range && rest) {
          return normalExCommand(range, rest, buffer, this.ctx.options);
        }
        throw new Error(`Unsupported Ex command: ${cmdName}`);
      }
    }
  }
}
