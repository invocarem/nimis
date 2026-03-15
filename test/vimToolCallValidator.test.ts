// test/vimToolCallValidator.test.ts
import { validateVimToolCall } from "../src/utils/vim/VimToolCallValidator";

describe("VimToolCallValidator", () => {
  describe("insert mode Esc validation", () => {
    it("passes when i is followed by \\x1b before :w", () => {
      const r = validateVimToolCall(["i", "hello", "\x1b", ":w"]);
      expect(r.valid).toBe(true);
      expect(r.errors).toHaveLength(0);
    });

    it("passes when o is followed by literal \\x1b before :w", () => {
      const r = validateVimToolCall(["o", "new line", "\\x1b", ":w"]);
      expect(r.valid).toBe(true);
      expect(r.errors).toHaveLength(0);
    });

    it("fails when i is not followed by \\x1b before :w", () => {
      const r = validateVimToolCall(["i", "hello", ":w"]);
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.includes("\\x1b") && e.includes(":w"))).toBe(true);
    });

    it("fails when o never ends with \\x1b", () => {
      const r = validateVimToolCall(["o", "new line"]);
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.includes("never ended"))).toBe(true);
    });

    it("passes when no insert commands", () => {
      const r = validateVimToolCall([":e file.txt", ":s/foo/bar/", ":w"]);
      expect(r.valid).toBe(true);
    });

    it("rejects multiple escapes (multiple changes in one tool call)", () => {
      const r = validateVimToolCall(["i", "a", "\x1b", "o", "b", "\x1b", ":w"]);
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.includes("Only 1 escape allowed"))).toBe(true);
    });

    it("rejects multiple line deletes (row numbers shift after first delete)", () => {
      const r = validateVimToolCall([":e file.txt", ":5d", ":10d", ":w"]);
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.includes("delete") && e.includes("Only 1"))).toBe(true);
    });

    it("rejects dd followed by :Nd", () => {
      const r = validateVimToolCall([":e file.txt", "dd", ":3d", ":w"]);
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.includes("delete"))).toBe(true);
    });

    it("passes single delete", () => {
      const r = validateVimToolCall([":e file.txt", ":5d", ":w"]);
      expect(r.valid).toBe(true);
    });

    it("passes single dd", () => {
      const r = validateVimToolCall([":e file.txt", "dd", ":w"]);
      expect(r.valid).toBe(true);
    });

    it("rejects call log with 4 escapes (multiple edits)", () => {
      const commands = [
        ":28",
        "o",
        "",
        "def power(a, b):",
        '    """Return a raised to the power of b."""',
        "    return a ** b",
        "\\x1b",
        ":59",
        "a",
        '    "power": power,',
        "\\x1b",
        ":46",
        "s",
        'print("Operations: add, subtract, multiply, divide, sine, cosine, power")',
        "\\x1b",
        ":36",
        "s",
        'two_arg_ops = ["add", "subtract", "multiply", "divide", "power"]',
        "\\x1b",
        ":%print #",
      ];
      const r = validateVimToolCall(commands);
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.includes("4 escape") && e.includes("Only 1 escape allowed"))).toBe(true);
    });
  });

  describe("substitute delimiter validation", () => {
    it("passes for simple substitute without / in pattern", () => {
      const r = validateVimToolCall([":%s/foo/bar/g"]);
      expect(r.valid).toBe(true);
    });

    it("fails when pattern contains unescaped / (path-like)", () => {
      const r = validateVimToolCall([":%s/usr/local/opt/g"]);
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.includes("delimiter") && e.includes("/"))).toBe(true);
    });

    it("fails when replacement contains unescaped /", () => {
      const r = validateVimToolCall([":s/foo/bar/baz/g"]);
      expect(r.valid).toBe(false);
    });

    it("passes when / is escaped in pattern", () => {
      const r = validateVimToolCall([":s/foo\\/bar/baz/"]);
      expect(r.valid).toBe(true);
    });

    it("passes for substitute with # delimiter (no validation of /)", () => {
      // # delimiter - we don't validate s#...  since it's not s/
      const r = validateVimToolCall([":%s#/usr/local#/opt#g"]);
      expect(r.valid).toBe(true);
    });
  });

  describe("retab validation", () => {
    it("passes for :retab without arg", () => {
      const r = validateVimToolCall([":retab", ":w"]);
      expect(r.valid).toBe(true);
    });

    it("passes for :retab! without arg", () => {
      const r = validateVimToolCall([":retab!", ":w"]);
      expect(r.valid).toBe(true);
    });

    it("passes for :retab 4", () => {
      const r = validateVimToolCall([":retab 4", ":w"]);
      expect(r.valid).toBe(true);
    });

    it("passes for :retab! 4", () => {
      const r = validateVimToolCall([":%retab! 4", ":w"]);
      expect(r.valid).toBe(true);
    });

    it("fails for :retab abc", () => {
      const r = validateVimToolCall([":retab abc"]);
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.includes("Invalid argument") && e.includes("retab"))).toBe(true);
    });

    it("fails for :retab 0", () => {
      const r = validateVimToolCall([":retab 0"]);
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.includes("Invalid argument") && e.includes("retab"))).toBe(true);
    });
  });

  describe("empty command in normal mode", () => {
    it("rejects empty string in normal mode (no buffer)", () => {
      const r = validateVimToolCall(["", ":e file.txt"], { hasBuffer: false });
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.includes("Empty command") && e.includes("normal mode"))).toBe(true);
    });

    it("rejects empty string in normal mode (with buffer)", () => {
      const r = validateVimToolCall([":w", "", ":q"], { hasBuffer: true });
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.includes("Empty command") && e.includes("normal mode"))).toBe(true);
    });

    it("allows empty string inside insert mode (blank line)", () => {
      const r = validateVimToolCall(["i", "line1", "", "line2", "\x1b", ":w"], { hasBuffer: true });
      expect(r.valid).toBe(true);
      expect(r.errors).toHaveLength(0);
    });

    it("allows empty line after Ex open-line :37o (insert mode)", () => {
      const commands = [
        ":38,45d",
        ":37o",
        "        \"divide\": divide,",
        "        \"power\": power,",
        "    }",
        "",
        "    if op not in operations:",
        "        print(f\"Unknown operation: {op}\")",
        "        sys.exit(1)",
        "\x1b",
        ":w",
      ];
      const r = validateVimToolCall(commands, { hasBuffer: true });
      expect(r.valid).toBe(true);
      expect(r.errors).toHaveLength(0);
    });

    it("allows empty line after Ex append :23a (insert mode)", () => {
      const commands = [
        ":23a",
        "def sine(a):",
        "    \"\"\"Return the sine of a (in radians).\"\"\"",
        "    return math.sin(a)",
        "",
        "def cosine(a):",
        "    \"\"\"Return the cosine of a (in radians).\"\"\"",
        "    return math.cos(a)",
        "\\x1b",
      ];
      const r = validateVimToolCall(commands, { hasBuffer: true });
      expect(r.valid).toBe(true);
      expect(r.errors).toHaveLength(0);
    });

    it("does not treat :50 or :50G as insert mode starters (empty line still rejected)", () => {
      // :50 and :50G are "go to line", not open-line; so "" after them is still normal mode
      const r1 = validateVimToolCall([":e f", ":50", "", ":w"], { hasBuffer: true });
      expect(r1.valid).toBe(false);
      expect(r1.errors.some((e) => e.includes("Empty command") && e.includes("normal mode"))).toBe(true);

      const r2 = validateVimToolCall([":e f", ":50G", "", ":w"], { hasBuffer: true });
      expect(r2.valid).toBe(false);
      expect(r2.errors.some((e) => e.includes("Empty command") && e.includes("normal mode"))).toBe(true);
    });

    it("allows newline in normal mode (Enter key has meaning)", () => {
      const r = validateVimToolCall(["\n", ":e file.txt"], { hasBuffer: false });
      expect(r.valid).toBe(true);
    });

    it("rejects multiple empty commands in normal mode", () => {
      const r = validateVimToolCall([":e x", "", "", ":w"], { hasBuffer: true });
      expect(r.valid).toBe(false);
      expect(r.errors.filter((e) => e.includes("Empty command") && e.includes("normal mode"))).toHaveLength(2);
    });
  });

  describe("combined validation", () => {
    it("collects multiple errors", () => {
      const r = validateVimToolCall(["i", "x", ":w", ":%s/path/to/file/replacement/g"]);
      expect(r.valid).toBe(false);
      expect(r.errors.length).toBeGreaterThanOrEqual(1);
    });
  });
});
