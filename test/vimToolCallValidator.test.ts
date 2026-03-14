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

    it("allows multiple insert blocks each with their own \\x1b", () => {
      const r = validateVimToolCall(["i", "a", "\x1b", "o", "b", "\x1b", ":w"]);
      expect(r.valid).toBe(true);
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

  describe("combined validation", () => {
    it("collects multiple errors", () => {
      const r = validateVimToolCall(["i", "x", ":w", ":%s/path/to/file/replacement/g"]);
      expect(r.valid).toBe(false);
      expect(r.errors.length).toBeGreaterThanOrEqual(1);
    });
  });
});
