// VimToolCallValidator.ts
// Validates Vim tool call commands before execution to catch common LLM mistakes.

/** \x1b is the hex for ESC (ASCII 27). Insert mode commands need it to return to normal mode. */
export const ESC = "\x1b";
export const ESC_LITERAL = "\\x1b";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validation strictness mode:
 * - none: No limits on escapes, deletes, or inserts per tool call.
 * - normal: At most one \\x1b and one line delete per tool call (current default).
 * - high: One modification per tool call (delete XOR insert); still one \\x1b max;
 *         delete or insert must include :print to verify the result.
 */
export type ValidationMode = "none" | "normal" | "high";

/**
 * Check if a string represents the Escape key (either actual \x1b or literal "\\x1b").
 */
function isEscape(cmd: string): boolean {
  return cmd === ESC || cmd === "\\x1b";
}

/**
 * Insert mode commands that require \x1b to exit back to normal mode.
 */
const INSERT_MODE_COMMANDS = new Set(["i", "a", "A", "I", "o", "O"]);

/**
 * Ex open-line commands like :37o or :5O (range + o/O) also enter insert mode.
 * Pattern: optional : followed by optional range (digits, comma, % . $ -) then o or O.
 */
function isExOpenLineCommand(cmd: string): boolean {
  const c = cmd.trim();
  return /^:[\s\d,%$.\-]*[oO]\s*$/.test(c);
}

/**
 * Ex append/insert commands like :23a or :5i (range + a(ppend) / i(nsert)) also enter insert mode.
 */
function isExAppendOrInsertCommand(cmd: string): boolean {
  const c = cmd.trim();
  return (
    /^:[\s\d,%$.\-]*a(?:ppend)?\s*$/i.test(c) ||
    /^:[\s\d,%$.\-]*i(?:nsert)?\s*$/i.test(c)
  );
}

/**
 * True if this command (trimmed) starts insert mode: i/a/A/I/o/O or :[range]o/O or :[range]a(ppend)/i(nsert).
 */
function isInsertModeStarter(cmd: string): boolean {
  const c = cmd.trim();
  if (INSERT_MODE_COMMANDS.has(c)) return true;
  if (isExOpenLineCommand(c)) return true;
  if (isExAppendOrInsertCommand(c)) return true;
  return false;
}

/**
 * Check if a command deletes one or more lines (row delete).
 * Multiple deletes in one tool call are error-prone: after the first delete,
 * line numbers shift, so the second/third delete may target wrong lines.
 */
function isLineDeleteCommand(cmd: string): boolean {
  const c = cmd.trim();
  // Ex: :d, :5d, :5,10d, :%d, :1,$d, :delete, :5delete, etc.
  if (/^:[\s\d%.,'$+\-]*\s*d(?:elete)?\s*$/i.test(c)) return true;
  // Normal: dd, 5dd
  if (/^\d*dd\s*$/.test(c)) return true;
  // Complex: 2Gdd, 3G2dd (go to line N, then delete)
  if (/^\d+G\d*dd\s*$/.test(c)) return true;
  return false;
}

/**
 * Count unescaped / in string. \/ is escaped.
 */
function countUnescapedSlashes(s: string): number {
  let count = 0;
  for (let j = 0; j < s.length; j++) {
    if (s[j] === "\\" && j + 1 < s.length) {
      j++; // skip escaped char
      continue;
    }
    if (s[j] === "/") count++;
  }
  return count;
}

/**
 * Substitute validation: when / is delimiter, pattern and replacement must not
 * contain unescaped / (would break parsing). E.g. :s/usr/local/opt/ parses as
 * pattern=usr, replacement=local — wrong. We detect by: if rest has 3+ unescaped /,
 * we get 4+ segments, so pattern or replacement likely contained /.
 *
 * Only match actual substitute commands (:s/, :%s/, :10,20s/), not paths containing "s/"
 * (e.g. :e! /path/to/nimis/file.txt).
 */
function validateSubstitute(cmd: string): string[] {
  const errors: string[] = [];
  const trimmed = cmd.trim();
  // Must be a substitute command: :[range]s/ - not :e! /path/nimis/ etc.
  if (!/^:[\s\d%.,'$+\-a-z]*s\//i.test(trimmed)) return errors;

  const m = trimmed.match(/s\/(.*)$/s);
  if (!m) return errors;

  const rest = m[1];
  const slashCount = countUnescapedSlashes(rest);
  // Normal: pattern/replacement/flags = 2 slashes. If 3+ slashes, pattern or replacement had /
  if (slashCount >= 3) {
    errors.push(
      `Substitute uses / as delimiter but pattern or replacement contains '/'. For paths use a different delimiter: :s#/path/old#/path/new#g`
    );
  }
  return errors;
}

/**
 * Track insert vs normal mode while scanning commands (same semantics as execution).
 * Only i/a/A/I/o/O as a single trimmed command start insert; \x1b ends it.
 */
function trackInsertBlocks(commands: string[]): boolean[] {
  const inInsertAt: boolean[] = [];
  let inInsertBlock = false;
  for (let i = 0; i < commands.length; i++) {
    const cmd = String(commands[i]).trim();
    if (!inInsertBlock && isInsertModeStarter(cmd)) {
      inInsertBlock = true;
      inInsertAt[i] = true;
      continue;
    }
    if (inInsertBlock) {
      if (isEscape(cmd)) {
        inInsertBlock = false;
        inInsertAt[i] = false;
        continue;
      }
      inInsertAt[i] = true;
      continue;
    }
    inInsertAt[i] = false;
  }
  return inInsertAt;
}

/**
 * Validate that empty string "" is not used in normal mode.
 * Empty string and newlines are allowed in insert mode (blank lines); in normal mode they are meaningless.
 */
function validateNoEmptyInNormalMode(commands: string[]): string[] {
  const errors: string[] = [];
  const inInsertAt = trackInsertBlocks(commands);
  for (let i = 0; i < commands.length; i++) {
    const raw = String(commands[i]);
    if (raw !== "") continue;
    if (inInsertAt[i]) continue; // allowed in insert mode
    errors.push(
      `Empty command at position ${i + 1} is not allowed in normal mode. Use empty lines only inside insert mode (between i/a/o/O and \\x1b).`
    );
  }
  return errors;
}

/**
 * When in insert mode, typed text may include lines starting with : (e.g. JS/TS
 * object literal "default: [...]" or "label: expr"). Only treat as Ex command if
 * it looks like a real Vim Ex command, not inserted code.
 */
function looksLikeExCommand(cmd: string): boolean {
  const c = cmd.trim();
  if (!c.startsWith(":")) return false;
  const rest = c.slice(1).trim();
  // Ex commands: :w, :q, :547, :s/old/new/, :e file, etc.
  // Inserted code patterns: ": [\"...\"]", "key: value", "; at end"
  if (/^\s*\[/.test(rest)) return false; // : [ ... - object/array literal
  if (/\\"/.test(c)) return false; // escaped quote (JSON/JS string)
  if (/;\s*$/.test(c)) return false; // semicolon at end (statement)
  if (/\]\s*;/.test(c)) return false; // ]; - array literal
  return true;
}

/**
 * Validate that insert mode blocks (i, o, a, A, I, O) are followed by \x1b before
 * :w or other Ex commands or end of command list.
 */
function validateInsertModeEsc(commands: string[]): string[] {
  const errors: string[] = [];
  let inInsertBlock = false;
  let insertStartIndex = -1;

  for (let i = 0; i < commands.length; i++) {
    const cmd = String(commands[i]).trim();
    const isEmptyOrNewline = cmd === "" || cmd === "\n" || cmd === "\r";

    // Only treat i,a,A,I,o,O or :[range]o/O as insert starters when NOT already in insert (in insert, they're typed text)
    if (!inInsertBlock && isInsertModeStarter(cmd)) {
      inInsertBlock = true;
      insertStartIndex = i;
      continue;
    }

    if (inInsertBlock) {
      if (isEscape(cmd)) {
        inInsertBlock = false;
        continue;
      }
      // Still in insert: blank lines and text are ok
      if (isEmptyOrNewline) continue;
      // Only treat as Ex command if it looks like one (not inserted code like ": [\"...\"]")
      if (cmd.startsWith(":") && looksLikeExCommand(cmd)) {
        errors.push(
          `Insert mode started at command ${insertStartIndex + 1} must end with \\x1b before Ex command (e.g. :w). Add \\x1b before "${cmd.substring(0, 30)}${cmd.length > 30 ? "..." : ""}"`
        );
        inInsertBlock = false;
      }
    }
  }

  if (inInsertBlock) {
    errors.push(
      `Insert mode started at command ${insertStartIndex + 1} never ended with \\x1b. You must add \\x1b after your text to return to normal mode.`
    );
  }

  return errors;
}

/**
 * Validate :retab - optional number is valid. :retab, :retab!, :retab 4, :retab! 4 all work.
 * Only validate invalid args like :retab abc or :retab 0.
 */
function validateRetab(cmd: string): string[] {
  const errors: string[] = [];
  const c = cmd.startsWith(":") ? cmd.slice(1) : cmd;
  const m = c.match(/^(?:\d+,\d+|%\s*|\d+\s*,\s*(?:\d+|\$|\.)|\.)?\s*ret(?:ab)?!?\s+(.+)$/i);
  if (!m) return errors;
  const args = m[1].trim();
  if (!args) return errors;
  const num = parseInt(args, 10);
  if (isNaN(num)) {
    errors.push(`Invalid argument for :retab. Got: "${args}". Use :retab 4 or :retab! 4`);
  } else if (num < 1) {
    errors.push(`Invalid argument for :retab. Tabstop must be >= 1, got: ${num}`);
  }
  return errors;
}

/** Commands that can run without an active buffer (no file open). */
function canRunWithoutBuffer(cmd: string): boolean {
  if (/^:\s*(pwd|cd\s|!|grep(\s|$))/.test(cmd)) return true;
  if (/^:\s*(term(?:inal|al)?|help)(\s|$)/.test(cmd)) return true;
  const diffMatch = cmd.match(/^:dif+f?\s+(.+)$/s);
  if (diffMatch) {
    const args = diffMatch[1].trim().split(/\s+/).filter(Boolean);
    return args.length >= 2; // :diff file1 file2
  }
  return false;
}

/** Check if the first command opens a file (:e) or runs without a buffer. */
function firstCommandOpensFileOrNeedsNoBuffer(commands: string[]): boolean {
  for (const raw of commands) {
    const c = String(raw).trim();
    if (c === "" || c === "\n" || c === "\r") continue;
    if (/^:e\s+/.test(c)) return true; // :e file
    if (canRunWithoutBuffer(c)) return true;
    return false; // First meaningful command needs a buffer
  }
  return false;
}

/** Check if command is a :print Ex command (e.g. :%print #, :.,+24print). */
function isPrintCommand(cmd: string): boolean {
  const c = cmd.trim();
  if (!c.startsWith(":")) return false;
  // :[range]print [#]
  if (/^:[\s\d%.,'$+\-]*print(\s+#)?\s*$/i.test(c)) return true;
  // :g/pat/print or :v/pat/print
  if (/^:[gv]\/.+\/print\s*$/i.test(c)) return true;
  return false;
}

/** True if commands contain at least one insert block (i/a/o/O...\\x1b). */
function hasInsertBlock(commands: string[]): boolean {
  const inInsertAt = trackInsertBlocks(commands);
  return inInsertAt.some(Boolean);
}

export interface ValidateOptions {
  /** When false, first command must open a file (:e) or be buffer-less (:pwd, :cd, etc.). */
  hasBuffer?: boolean;
  /** Validation strictness. Default: "normal". */
  mode?: ValidationMode;
}

/**
 * Validate the full vim tool call before execution.
 */
export function validateVimToolCall(
  commands: string[],
  options?: ValidateOptions
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const hasBuffer = options?.hasBuffer ?? true; // Default true for backward compat
  const mode = options?.mode ?? "normal";

  if (!Array.isArray(commands) || commands.length === 0) {
    return { valid: true, errors: [], warnings: [] };
  }

  const cmdList = commands as string[];

  // 0. When no buffer: first command must open a file or be buffer-less
  if (!hasBuffer && !firstCommandOpensFileOrNeedsNoBuffer(cmdList)) {
    const first = cmdList.find((c) => {
      const t = String(c).trim();
      return t !== "" && t !== "\n" && t !== "\r";
    });
    const preview = String(first ?? cmdList[0] ?? "").substring(0, 40);
    errors.push(
      `No buffer open. Use :e <file> first to open a file (paths are relative to current working directory), or :e . to list current folder, or use :pwd/:cd/:!/:grep/:diff/:terminal/:help for directory/shell/terminal/help. First command was: "${preview}${preview.length >= 40 ? "..." : ""}"`
    );
  }

  const escapeCount = cmdList.filter((c) => isEscape(String(c).trim())).length;
  const deleteCount = cmdList.filter((c) => isLineDeleteCommand(String(c))).length;
  const hasInsert = hasInsertBlock(cmdList);
  const hasPrint = cmdList.some((c) => isPrintCommand(String(c).trim()));

  // 1. At most one escape per tool call (skip in none mode)
  if (mode !== "none" && escapeCount > 1) {
    errors.push(
      `Commands contain ${escapeCount} escape(s) (\\x1b). Only 1 escape allowed per tool call. Split into separate tool calls for multiple edits.`
    );
  }

  // 1b. At most one line delete per tool call (skip in none mode)
  if (mode !== "none" && deleteCount > 1) {
    errors.push(
      `Commands contain ${deleteCount} line delete(s) (:d, dd, etc.). Only 1 delete allowed per tool call. After a delete, line numbers shift—split into separate tool calls for multiple deletes.`
    );
  }

  // 1c. High mode: one modification per tool call (delete XOR insert)
  if (mode === "high" && deleteCount > 0 && hasInsert) {
    errors.push(
      `High mode: only one modification per tool call. You have both delete and insert—split into separate tool calls.`
    );
  }

  // 1d. High mode: delete or insert must include :print to verify the result
  if (mode === "high" && (deleteCount > 0 || hasInsert) && !hasPrint) {
    errors.push(
      `High mode: delete or insert must include :print to verify the result (e.g. :%print # or :.,+24print #).`
    );
  }

  // 2. Insert mode Esc validation
  const insertErrors = validateInsertModeEsc(cmdList);
  errors.push(...insertErrors);

  // 2b. Empty string only allowed in insert mode (meaningless in normal mode)
  const emptyInNormalErrors = validateNoEmptyInNormalMode(cmdList);
  errors.push(...emptyInNormalErrors);

  // 3. Substitute delimiter validation (Ex commands)
  for (let i = 0; i < cmdList.length; i++) {
    const c = String(cmdList[i]).trim();
    if (c.startsWith(":") && (c.includes("s/") || c.match(/\bs\s*\//))) {
      const subErrors = validateSubstitute(c);
      errors.push(...subErrors);
    }
    if (/ret(?:ab)?!?\s+/.test(c) || /ret(?:ab)?!?\s*$/.test(c)) {
      const retabErrors = validateRetab(c.startsWith(":") ? c : ":" + c);
      errors.push(...retabErrors);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
