// test/vim.vimPatternToJs.test.ts
// Unit tests for vimPatternToJs - Vim regex to JavaScript RegExp conversion
import { vimPatternToJs, substituteWithPattern } from "../src/utils/vim/operations/TextOperations";
import { createBuffer } from "../src/utils/vim/models/VimBuffer";

describe("vimPatternToJs - anchors ^ and $", () => {
  it("passes ^ (start of line) through unchanged", () => {
    const pattern = "^foo";
    const jsPattern = vimPatternToJs(pattern);
    const regex = new RegExp(jsPattern);
    expect(regex.test("foo")).toBe(true);
    expect(regex.test("bar foo")).toBe(false);
    expect(regex.test("  foo")).toBe(false);
  });

  it("passes $ (end of line) through unchanged", () => {
    const pattern = "foo$";
    const jsPattern = vimPatternToJs(pattern);
    const regex = new RegExp(jsPattern);
    expect(regex.test("foo")).toBe(true);
    expect(regex.test("foo bar")).toBe(false);
    expect(regex.test("bar")).toBe(false);
  });

  it("handles ^ and $ together for full-line match", () => {
    const pattern = "^hello$";
    const jsPattern = vimPatternToJs(pattern);
    const regex = new RegExp(jsPattern);
    expect(regex.test("hello")).toBe(true);
    expect(regex.test("hello world")).toBe(false);
    expect(regex.test("say hello")).toBe(false);
  });
});

describe("vimPatternToJs - \\( \\) capture groups", () => {
  it("converts \\( \\) to ( ) for capture groups", () => {
    const pattern = "\\(foo\\)"; // Vim: \(foo\)
    const jsPattern = vimPatternToJs(pattern);
    expect(jsPattern).toBe("(foo)");
    const regex = new RegExp(jsPattern);
    const m = "hello foo world".match(regex);
    expect(m).not.toBeNull();
    expect(m![1]).toBe("foo");
  });

  it("handles multiple capture groups", () => {
    const pattern = "\\(a\\)\\(b\\)\\(c\\)";
    const jsPattern = vimPatternToJs(pattern);
    expect(jsPattern).toBe("(a)(b)(c)");
    const regex = new RegExp(jsPattern);
    const m = "xyz abc def".match(regex);
    expect(m).not.toBeNull();
    expect(m![1]).toBe("a");
    expect(m![2]).toBe("b");
    expect(m![3]).toBe("c");
  });
});

describe("vimPatternToJs - .* and quantifiers", () => {
  it("passes . (any char) and * (Kleene star) through unchanged", () => {
    const pattern = ".*";
    const jsPattern = vimPatternToJs(pattern);
    expect(jsPattern).toBe(".*");
    const regex = new RegExp(jsPattern);
    expect(regex.test("")).toBe(true);
    expect(regex.test("x")).toBe(true);
    expect(regex.test("hello world")).toBe(true);
  });

  it("handles .* with anchors for full-line capture", () => {
    const pattern = "^\\(.*\\)$";
    const jsPattern = vimPatternToJs(pattern);
    expect(jsPattern).toBe("^(.*)$");
    const regex = new RegExp(jsPattern);
    const m = "hello world".match(regex);
    expect(m).not.toBeNull();
    expect(m![1]).toBe("hello world");
  });
});

describe("vimPatternToJs - \\1 backreference in pattern", () => {
  it("passes \\1 through for backreference to first capture group", () => {
    const pattern = "\\(foo\\)bar\\1"; // match foobarfoo
    const jsPattern = vimPatternToJs(pattern);
    expect(jsPattern).toBe("(foo)bar\\1");
    const regex = new RegExp(jsPattern);
    expect(regex.test("foobarfoo")).toBe(true);
    expect(regex.test("foobarbar")).toBe(false);
  });

  it("handles \\2 for second capture group", () => {
    const pattern = "\\(a\\)\\(b\\)\\2\\1"; // match abba
    const jsPattern = vimPatternToJs(pattern);
    expect(jsPattern).toBe("(a)(b)\\2\\1");
    const regex = new RegExp(jsPattern);
    expect(regex.test("abba")).toBe(true);
    expect(regex.test("abab")).toBe(false);
  });
});

describe("vimPatternToJs - \\t (tab) handling", () => {
  it("produces regex matching tab when pattern is backslash-t (e.g. from :%s/\\t/    /g)", () => {
    const pattern = "\\" + "t"; // backslash + t - as in command :%s/\t/    /g
    const jsPattern = vimPatternToJs(pattern);
    const regex = new RegExp(jsPattern);
    expect(regex.test("\t")).toBe(true);
    expect(regex.test("  ")).toBe(false);
  });

  it("produces regex matching tab when pattern is literal tab (e.g. from JSON.parse)", () => {
    // When JSON has ":%s/\t/    /g", \t parses to literal tab - pattern becomes single tab char
    const pattern = "\t";
    const jsPattern = vimPatternToJs(pattern);
    const regex = new RegExp(jsPattern);
    expect(regex.test("\t")).toBe(true);
    expect(regex.test("  ")).toBe(false);
  });
});

describe("substituteWithPattern - tab substitution", () => {
  it("substitutes tabs when pattern is literal tab (e.g. from JSON.parse)", () => {
    const buffer = createBuffer("/test/file.txt", ["\thello", "\t\tworld"], "\n");
    const result = substituteWithPattern(
      { start: 0, end: 1 },
      "\t", // literal tab - as from JSON.parse('{"x":"\t"}').x
      "    ",
      "g",
      buffer
    );
    expect(result).toContain("Substituted 3 occurrence");
    expect(buffer.content[0]).toBe("    hello");
    expect(buffer.content[1]).toBe("        world");
  });

  it("substitutes with tab when replacement is backslash-t (e.g. :%s/^ /\\t/g from JSON)", () => {
    // When LLM sends ":%s/^ /\\t/g", JSON parses \\t as the two chars \ + t.
    // escapeReplacementForJs must convert that to actual tab.
    const buffer = createBuffer("/test/file.txt", ["  foo", " bar", "baz"], "\n");
    const replacement = "\\" + "t"; // backslash + t - as from JSON "\\t"
    const result = substituteWithPattern(
      { start: 0, end: 2 },
      "^ ", // leading space
      replacement,
      "g",
      buffer
    );
    expect(result).toContain("Substituted 2 occurrence");
    expect(buffer.content[0]).toBe("\t foo");
    expect(buffer.content[1]).toBe("\tbar");
    expect(buffer.content[2]).toBe("baz");
  });
});

describe("substituteWithPattern - \\( \\) and \\1 in replacement", () => {
  it("indents lines using ^\\(.*\\) and \\1 in replacement (like :%s/^\\(.*\\)/    \\1/)", () => {
    const buffer = createBuffer("/test/file.txt", ["foo bar", "hello world", "baz qux"], "\n");
    const result = substituteWithPattern(
      { start: 0, end: 2 },
      "^\\(.*\\)", // Vim pattern - vimPatternToJs converts \( \) to ( )
      "    \\1",   // Replacement - escapeReplacementForJs converts \1 to $1
      "g",
      buffer
    );
    expect(result).toContain("Substituted 3 occurrence");
    expect(buffer.content[0]).toBe("    foo bar");
    expect(buffer.content[1]).toBe("    hello world");
    expect(buffer.content[2]).toBe("    baz qux");
  });
});
