// test/toolCallXmlValidator.test.ts
import {
  validateToolCallXml,
  looksLikeToolCallXml,
} from "../src/utils/ToolCallXmlValidator";

describe("ToolCallXmlValidator", () => {
  describe("looksLikeToolCallXml", () => {
    it("returns true for <tool_call name=\"vim\">", () => {
      expect(looksLikeToolCallXml('<tool_call name="vim">')).toBe(true);
    });

    it("returns true for <MCP_CALL name=\"foo\">", () => {
      expect(looksLikeToolCallXml('<MCP_CALL name="foo">')).toBe(true);
    });

    it("returns true when tool_call appears in middle of text", () => {
      expect(looksLikeToolCallXml("Here is my response:\n<tool_call name=\"vim\">")).toBe(true);
    });

    it("returns false for plain text", () => {
      expect(looksLikeToolCallXml("Hello world")).toBe(false);
    });

    it("returns false for <tool_call without space (invalid)", () => {
      expect(looksLikeToolCallXml("<tool_call>")).toBe(false);
    });
  });

  describe("missing closing tag", () => {
    it("fails when </tool_call> is missing", () => {
      const r = validateToolCallXml('<tool_call name="vim"><commands>foo</commands>');
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.includes("Missing closing tag") && e.includes("</tool_call>"))).toBe(true);
    });

    it("fails when tool call is truncated mid-content", () => {
      const r = validateToolCallXml('<tool_call name="vim"><commands><![CDATA[');
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.includes("Missing closing tag"))).toBe(true);
    });

    it("passes when </tool_call> is present", () => {
      const r = validateToolCallXml(
        '<tool_call name="vim"><commands><![CDATA[:e file.txt]]></commands></tool_call>'
      );
      expect(r.valid).toBe(true);
      expect(r.errors).toHaveLength(0);
    });
  });

  describe("child tag validation", () => {
    it("passes for supported child tags (commands, file_path)", () => {
      const r = validateToolCallXml(
        '<tool_call name="vim"><commands><![CDATA[:e x]]></commands></tool_call>'
      );
      expect(r.valid).toBe(true);
    });

    it("fails for unsupported child tag", () => {
      const r = validateToolCallXml(
        '<tool_call name="vim"><foo>bar</foo></tool_call>'
      );
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.includes("Unsupported tag") && e.includes("<foo>"))).toBe(true);
    });

    it("fails when child tag is unclosed", () => {
      const r = validateToolCallXml(
        '<tool_call name="vim"><commands>foo</tool_call>'
      );
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.includes("Unclosed tag") && e.includes("<commands>"))).toBe(true);
    });

    it("fails when tags are mismatched", () => {
      const r = validateToolCallXml(
        '<tool_call name="vim"><commands>foo</file_path></tool_call>'
      );
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.includes("Mismatched tag") && e.includes("</commands>"))).toBe(true);
    });

    it("passes for file_path, old_text, new_text, content", () => {
      const r = validateToolCallXml(
        '<tool_call name="edit"><file_path>a.ts</file_path><old_text>x</old_text><new_text>y</new_text></tool_call>'
      );
      expect(r.valid).toBe(true);
    });

    it("passes for exec_terminal with command and working_directory child elements", () => {
      const r = validateToolCallXml(
        '<tool_call name="exec_terminal"><command>npm run build</command><working_directory>src</working_directory></tool_call>'
      );
      expect(r.valid).toBe(true);
    });

    it("passes for MCP_CALL with args child element", () => {
      const r = validateToolCallXml(
        '<MCP_CALL name="analyze_latin"><args>{"word": "amo"}</args></MCP_CALL>'
      );
      expect(r.valid).toBe(true);
    });
  });

  describe("self-closing tags", () => {
    it("passes for self-closing tool_call", () => {
      const r = validateToolCallXml('<tool_call name="vim" />');
      expect(r.valid).toBe(true);
    });

    it("passes for self-closing with attributes", () => {
      const r = validateToolCallXml('<tool_call name="read_file" path="src/index.ts" />');
      expect(r.valid).toBe(true);
    });
  });

  describe("CDATA handling", () => {
    it("passes when content has CDATA with < and > inside", () => {
      const r = validateToolCallXml(
        '<tool_call name="vim"><commands><![CDATA[:e file.ts\n:s/old/new/g\n:w]]></commands></tool_call>'
      );
      expect(r.valid).toBe(true);
    });

    it("passes when CDATA contains XML-like text", () => {
      const r = validateToolCallXml(
        '<tool_call name="vim"><commands><![CDATA[if (x < 5 && y > 3) {}]]></commands></tool_call>'
      );
      expect(r.valid).toBe(true);
    });
  });

  describe("empty and edge cases", () => {
    it("passes for empty string", () => {
      const r = validateToolCallXml("");
      expect(r.valid).toBe(true);
    });

    it("passes for text without tool_call", () => {
      const r = validateToolCallXml("Just some text without any XML.");
      expect(r.valid).toBe(true);
    });

    it("passes for multiple valid tool calls", () => {
      const r = validateToolCallXml(
        '<tool_call name="vim"><commands>a</commands></tool_call>' +
        '<tool_call name="vim"><commands>b</commands></tool_call>'
      );
      expect(r.valid).toBe(true);
    });

    it("stops after first block when validateFirstOnly is true", () => {
      const text = '<tool_call name="vim"><commands>a</commands>';
      const r = validateToolCallXml(text, { validateFirstOnly: true });
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.includes("Missing closing tag"))).toBe(true);
    });
  });

  describe("custom supportedChildTags", () => {
    it("accepts custom whitelist", () => {
      const r = validateToolCallXml(
        '<tool_call name="custom"><my_arg>value</my_arg></tool_call>',
        { supportedChildTags: new Set(["my_arg"]) }
      );
      expect(r.valid).toBe(true);
    });

    it("rejects tag not in custom whitelist", () => {
      const r = validateToolCallXml(
        '<tool_call name="custom"><commands>a</commands></tool_call>',
        { supportedChildTags: new Set(["my_arg"]) }
      );
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.includes("Unsupported tag") && e.includes("<commands>"))).toBe(true);
    });
  });

  describe("MCP_CALL support", () => {
    it("validates MCP_CALL same as tool_call", () => {
      const r = validateToolCallXml(
        '<MCP_CALL name="vim"><commands>a</commands></MCP_CALL>'
      );
      expect(r.valid).toBe(true);
    });

    it("fails when MCP_CALL is missing closing tag", () => {
      const r = validateToolCallXml('<MCP_CALL name="vim"><commands>a</commands>');
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.includes("</MCP_CALL>"))).toBe(true);
    });
  });
});
