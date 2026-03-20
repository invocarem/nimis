import { parseChatDirective } from "../src/utils/chatDirectiveParser";

describe("parseChatDirective", () => {
  describe("@vim", () => {
    it("parses @vim :150 as ex command", () => {
      expect(parseChatDirective("@vim :150")).toEqual({
        kind: "vim",
        command: ":150",
      });
    });

    it("parses @vim dd as normal command", () => {
      expect(parseChatDirective("@vim dd")).toEqual({
        kind: "vim",
        command: "dd",
      });
    });

    it("parses @vim :e abc.py preserving whitespace in path", () => {
      expect(parseChatDirective("@vim :e abc.py")).toEqual({
        kind: "vim",
        command: ":e abc.py",
      });
    });

    it("parses @vim with multi-word ex command", () => {
      expect(parseChatDirective("@vim :set number relativenumber")).toEqual({
        kind: "vim",
        command: ":set number relativenumber",
      });
    });

    it("returns vim with empty command when only @vim", () => {
      expect(parseChatDirective("@vim")).toEqual({
        kind: "vim",
        command: "",
      });
    });

    it("is case-insensitive", () => {
      expect(parseChatDirective("@VIM dd")).toEqual({
        kind: "vim",
        command: "dd",
      });
    });

    it("rejects @vimdd (no space) as unknown directive", () => {
      expect(parseChatDirective("@vimdd")).toEqual({
        kind: "unknown",
        directive: "vimdd",
        payload: "",
      });
    });
  });

  describe("@file", () => {
    it("parses @file with path", () => {
      expect(parseChatDirective("@file src/foo.ts")).toEqual({
        kind: "file",
        path: "src/foo.ts",
      });
    });

    it("parses @file with path containing spaces", () => {
      expect(parseChatDirective("@file my project/main.py")).toEqual({
        kind: "file",
        path: "my project/main.py",
      });
    });
  });

  describe("@mcp", () => {
    it("parses @mcp with tool and args", () => {
      expect(parseChatDirective("@mcp grep pattern")).toEqual({
        kind: "mcp",
        payload: "grep pattern",
      });
    });
  });

  describe("@@ literal", () => {
    it("strips one @ for @@hello", () => {
      expect(parseChatDirective("@@hello")).toEqual({
        kind: "literal",
        message: "@hello",
      });
    });

    it("passes @@vim dd to LLM as @vim dd", () => {
      expect(parseChatDirective("@@vim dd")).toEqual({
        kind: "literal",
        message: "@vim dd",
      });
    });
  });

  describe("normal message", () => {
    it("returns normal for plain text", () => {
      expect(parseChatDirective("hello world")).toEqual({
        kind: "normal",
        message: "hello world",
      });
    });

    it("returns normal for text with @ in middle", () => {
      expect(parseChatDirective("send to @user")).toEqual({
        kind: "normal",
        message: "send to @user",
      });
    });

    it("trims leading/trailing whitespace", () => {
      expect(parseChatDirective("  @vim dd  ")).toEqual({
        kind: "vim",
        command: "dd",
      });
    });
  });

  describe("unknown directive", () => {
    it("returns unknown for @vimdd", () => {
      expect(parseChatDirective("@vimdd")).toEqual({
        kind: "unknown",
        directive: "vimdd",
        payload: "",
      });
    });

    it("returns unknown for @foo", () => {
      expect(parseChatDirective("@foo bar")).toEqual({
        kind: "unknown",
        directive: "foo",
        payload: "bar",
      });
    });
  });
});
