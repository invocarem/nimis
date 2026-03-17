// ToolCallXmlValidator.ts
// Validates XML structure of <tool_call name="xxx"> blocks from LLM output.
// Catches common mistakes: missing </tool_call>, unclosed tags, unsupported child tags.
// Does NOT validate OpenAI Harmony tool call protocol (JSON format).

export interface ToolCallXmlValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Child elements allowed inside <tool_call> body.
 * Extensible per tool if needed; this is the default whitelist.
 */
const DEFAULT_SUPPORTED_CHILD_TAGS = new Set([
  "commands",
  "file_path",
  "path",
  "old_text",
  "new_text",
  "content",
  "arguments",
  "reasoning",
]);

/** Pattern to detect start of a tool call block */
const TOOL_CALL_START = /<(tool_call|MCP_CALL)(?=\s)/gi;

/**
 * Check if text contains or starts with a tool call XML block.
 * Uses a new regex per call to avoid lastIndex state from global flag.
 */
export function looksLikeToolCallXml(text: string): boolean {
  return new RegExp(TOOL_CALL_START.source, "i").test(text);
}

/**
 * Find the end of an opening tag: <tag attr="val"> or <tag attr="val" />
 * Handles quoted attributes; returns index of > or -1 if malformed.
 */
function findOpeningTagEnd(text: string, start: number, tagName: string): number {
  const tagStart = `<${tagName}`.toLowerCase();
  const slice = text.slice(start);
  if (!slice.toLowerCase().startsWith(tagStart)) return -1;

  let i = tagStart.length;
  let inDouble = false;
  let inSingle = false;

  while (i < slice.length) {
    const c = slice[i];
    if (inDouble) {
      if (c === '"' && slice[i - 1] !== "\\") inDouble = false;
      i++;
      continue;
    }
    if (inSingle) {
      if (c === "'" && slice[i - 1] !== "\\") inSingle = false;
      i++;
      continue;
    }
    if (c === '"') inDouble = true;
    else if (c === "'") inSingle = true;
    else if (c === ">") return start + i;
    else if (c === "/" && i + 1 < slice.length && slice[i + 1] === ">") {
      return start + i + 1; // self-closing
    }
    i++;
  }
  return -1;
}

/**
 * Check if the tag at position is self-closing (ends with />).
 * end is the index of the closing >.
 */
function isSelfClosing(text: string, end: number): boolean {
  return end >= 1 && text[end - 1] === "/";
}

/**
 * Extract text between opening and closing tags, handling CDATA.
 * Returns the inner content (between > and </tag>) or null if not found.
 */
function extractContentUntilClosingTag(
  text: string,
  contentStart: number,
  tagName: string
): { content: string; endIndex: number } | null {
  const closeTag = `</${tagName}>`;
  const closeTagLower = closeTag.toLowerCase();
  let i = contentStart;
  const len = text.length;

  while (i < len) {
    let next = text.indexOf("<", i);
    if (next === -1) return null;

    const after = text.slice(next);
    if (after.toLowerCase().startsWith("<![cdata[")) {
      const cdataEnd = text.indexOf("]]>", next);
      if (cdataEnd === -1) return null;
      i = cdataEnd + 3;
      continue;
    }
    if (after.toLowerCase().startsWith(closeTagLower)) {
      const content = text.slice(contentStart, next).trim();
      return { content, endIndex: next + closeTag.length };
    }
    i = next + 1;
  }
  return null;
}

/**
 * Find the index of the closing > of an opening tag, handling quoted attributes.
 * Returns -1 if not found.
 */
function findOpeningTagEndInContent(content: string, start: number): number {
  let i = start + 1; // skip <
  let inDouble = false;
  let inSingle = false;
  while (i < content.length) {
    const c = content[i];
    if (inDouble) {
      if (c === '"' && content[i - 1] !== "\\") inDouble = false;
      i++;
      continue;
    }
    if (inSingle) {
      if (c === "'" && content[i - 1] !== "\\") inSingle = false;
      i++;
      continue;
    }
    if (c === '"') inDouble = true;
    else if (c === "'") inSingle = true;
    else if (c === ">") return i;
    else if (c === "/" && i + 1 < content.length && content[i + 1] === ">") return i + 1;
    i++;
  }
  return -1;
}

/**
 * Find all opening/closing tag pairs in content (excluding CDATA).
 * Returns list of { name, isClosing }.
 */
function findTagsInContent(content: string): Array<{ name: string; isClosing: boolean }> {
  const tags: Array<{ name: string; isClosing: boolean }> = [];
  let i = 0;
  while (i < content.length) {
    const open = content.indexOf("<", i);
    if (open === -1) break;
    const after = content.slice(open);
    if (after.startsWith("<![CDATA[") || after.startsWith("<![cdata[")) {
      const end = content.indexOf("]]>", open);
      i = end === -1 ? content.length : end + 3;
      continue;
    }
    const closeMatch = after.match(/^<\/(\w+)>/);
    const openMatch = after.match(/^<(\w+)(?:\s|>|\/)/);
    if (closeMatch) {
      tags.push({ name: closeMatch[1].toLowerCase(), isClosing: true });
      i = open + closeMatch[0].length;
    } else if (openMatch) {
      const tagName = openMatch[1].toLowerCase();
      const tagEnd = findOpeningTagEndInContent(content, open);
      const nextI = tagEnd === -1 ? open + 1 : tagEnd + 1;
      if (tagName !== "tool_call" && tagName !== "mcp_call") {
        tags.push({ name: tagName, isClosing: false });
      }
      i = nextI;
    } else {
      i = open + 1;
    }
  }
  return tags;
}

/**
 * Validate that tags are balanced and all are supported.
 */
function validateChildTags(
  content: string,
  supportedChildTags: Set<string>
): string[] {
  const errors: string[] = [];
  const tags = findTagsInContent(content);
  const stack: string[] = [];

  for (const { name, isClosing } of tags) {
    if (!supportedChildTags.has(name)) {
      errors.push(`Unsupported tag: <${name}>. Only these child tags are allowed: ${[...supportedChildTags].sort().join(", ")}`);
    }
    if (isClosing) {
      if (stack.length === 0) {
        errors.push(`Unexpected closing tag </${name}> without matching opening tag`);
      } else if (stack[stack.length - 1] !== name) {
        errors.push(`Mismatched tag: expected </${stack[stack.length - 1]}> but found </${name}>`);
      } else {
        stack.pop();
      }
    } else {
      stack.push(name);
    }
  }

  if (stack.length > 0) {
    errors.push(`Unclosed tag(s): ${stack.map((t) => `<${t}>`).join(", ")}`);
  }
  return errors;
}

export interface ToolCallXmlValidatorOptions {
  /** Child tags allowed inside <tool_call> body. Default: commands, file_path, etc. */
  supportedChildTags?: Set<string>;
  /** If true, only validate the first tool_call block (e.g. when streaming). */
  validateFirstOnly?: boolean;
}

/**
 * Validate XML structure of tool call blocks in text.
 * Use when LLM output starts with or contains <tool_call name="xxx">.
 */
export function validateToolCallXml(
  text: string,
  options?: ToolCallXmlValidatorOptions
): ToolCallXmlValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const supportedChildTags = options?.supportedChildTags ?? DEFAULT_SUPPORTED_CHILD_TAGS;
  const validateFirstOnly = options?.validateFirstOnly ?? false;

  if (!text || typeof text !== "string") {
    return { valid: true, errors: [], warnings: [] };
  }

  let pos = 0;
  const regex = new RegExp(TOOL_CALL_START.source, "gi");
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const startPos = match.index;
    const tagName = match[1];
    const openEnd = findOpeningTagEnd(text, startPos, tagName);

    if (openEnd === -1) {
      errors.push(`Malformed opening tag <${tagName}...> at position ${startPos}`);
      if (validateFirstOnly) break;
      continue;
    }

    if (isSelfClosing(text, openEnd)) {
      pos = openEnd;
      if (validateFirstOnly) break;
      continue;
    }

    const contentStart = openEnd;
    const extracted = extractContentUntilClosingTag(text, contentStart, tagName);

    if (!extracted) {
      errors.push(
        `Missing closing tag </${tagName}>. The tool call that starts at position ${startPos} is not properly closed.`
      );
      if (validateFirstOnly) break;
      continue;
    }

    const childErrors = validateChildTags(extracted.content, supportedChildTags);
    errors.push(...childErrors);

    pos = extracted.endIndex;
    if (validateFirstOnly) break;
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
