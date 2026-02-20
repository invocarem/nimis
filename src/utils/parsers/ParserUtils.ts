import { HtmlEntityDecoder } from "../htmlEntityDecoder";

/**
 * Shared utilities for attribute parsing
 */
export class ParserUtils {
  /**
   * Extract the name attribute from attributes string
   */
  static extractName(attributes: string): string | null {
    const nameMatch = attributes.match(/name=["']([^"']+)["']/);
    return nameMatch ? nameMatch[1] : null;
  }

  /**
   * Find the starting position of args value after args=" or args='
   */
  static findArgsStart(
    attributes: string
  ): { startPos: number; quoteChar: string } | null {
    const argsDoubleQuoteMatch = attributes.match(/args\s*=\s*"/);
    const argsSingleQuoteMatch = attributes.match(/args\s*=\s*'/);

    if (argsDoubleQuoteMatch) {
      return {
        startPos: argsDoubleQuoteMatch.index! + argsDoubleQuoteMatch[0].length,
        quoteChar: '"',
      };
    }

    if (argsSingleQuoteMatch) {
      return {
        startPos: argsSingleQuoteMatch.index! + argsSingleQuoteMatch[0].length,
        quoteChar: "'",
      };
    }

    return null;
  }

  /**
   * Decode HTML entities and parse JSON
   * Handles triple-quoted strings (""") that LLMs sometimes output in JSON
   * Fixes invalid escape sequences (e.g. Windows paths c:\code where LLM outputs single backslash)
   */
  static decodeAndParseJson(jsonStr: string): any {
    const decoded = HtmlEntityDecoder.decode(jsonStr);
    // Normalize triple-quoted strings before JSON.parse
    const normalized = this.normalizeTripleQuotedStrings(decoded);
    // Fix invalid JSON escapes (e.g. \c, \g in c:\code\github - valid: \" \\ \/ \b \f \n \r \t \uXXXX)
    const fixedEscapes = this.fixInvalidJsonEscapes(normalized);
    return JSON.parse(fixedEscapes);
  }

  /**
   * Fix invalid JSON escape sequences. LLMs often output Windows paths like c:\code
   * with single backslashes; JSON requires \\ for literal backslash.
   * Valid escapes: \" \\ \/ \b \f \n \r \t \uXXXX
   */
  private static fixInvalidJsonEscapes(jsonStr: string): string {
    return jsonStr.replace(/\\(.)/g, (match, char, offset) => {
      if ('"\\/bfnrt'.includes(char)) return match;
      if (char === "u") {
        const hex = jsonStr.slice(offset + 2, offset + 6);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) return match;
      }
      // Invalid: \c, \g, \:, etc. - escape the backslash so it becomes literal
      return "\\\\" + char;
    });
  }

  /**
   * Normalizes Python-style triple-quoted strings (""") to regular JSON strings.
   * Preserves all whitespace and content exactly.
   */
  private static normalizeTripleQuotedStrings(jsonStr: string): string {
    // Quick check: if no triple quotes exist, return as-is
    if (!jsonStr.includes('"""')) {
      return jsonStr;
    }

    let result = '';
    let i = 0;
    let inTripleQuote = false;

    while (i < jsonStr.length) {
      // Check for triple quote start """ (not escaped)
      if (!inTripleQuote &&
        i + 2 < jsonStr.length &&
        jsonStr[i] === '"' &&
        jsonStr[i + 1] === '"' &&
        jsonStr[i + 2] === '"' &&
        (i === 0 || jsonStr[i - 1] !== '\\')) {
        // Check if this is a value (after : or ,) not a key
        const before = jsonStr.substring(0, i).trim();
        const lastColon = before.lastIndexOf(':');
        const lastComma = before.lastIndexOf(',');
        const lastBrace = before.lastIndexOf('{');
        const lastBracket = before.lastIndexOf('[');

        // Only treat as triple quote if it's after : or , (i.e., a value, not a key)
        if (lastColon > Math.max(lastComma, lastBrace, lastBracket)) {
          inTripleQuote = true;
          result += '"'; // Start regular JSON string
          i += 3; // Skip """
          continue;
        }
      }

      // Check for triple quote end """ (not escaped)
      if (inTripleQuote &&
        i + 2 < jsonStr.length &&
        jsonStr[i] === '"' &&
        jsonStr[i + 1] === '"' &&
        jsonStr[i + 2] === '"' &&
        (i === 0 || jsonStr[i - 1] !== '\\')) {
        // Check if followed by , } ] or end of string (end of value)
        const after = jsonStr.substring(i + 3).trim();
        if (after.length === 0 || /^[,}\]]/.test(after)) {
          inTripleQuote = false;
          result += '"'; // End regular JSON string
          i += 3; // Skip """
          continue;
        }
      }

      if (inTripleQuote) {
        const char = jsonStr[i];
        // Escape any unescaped double quotes inside the triple-quoted string
        if (char === '"' &&
          (i === 0 || jsonStr[i - 1] !== '\\') &&
          !(i + 2 < jsonStr.length && jsonStr[i + 1] === '"' && jsonStr[i + 2] === '"')) {
          // Regular quote inside triple-quoted string - escape it
          result += '\\"';
          i++;
          continue;
        }
        // Preserve all other characters including whitespace exactly
        if (char === '\n') {
          result += '\\n';
        } else if (char === '\r') {
          result += '\\r';
        } else if (char === '\t') {
          result += '\\t';
        } else if (char === '\\') {
          // Preserve escape sequences
          result += char;
          if (i + 1 < jsonStr.length) {
            result += jsonStr[i + 1];
            i += 2;
            continue;
          }
        } else {
          result += char;
        }
      } else {
        result += jsonStr[i];
      }

      i++;
    }

    // If we ended while still in a triple quote, close it
    if (inTripleQuote) {
      result += '"';
    }

    return result;
  }

  /**
   * Check if a string is a placeholder pattern like "{...}" or "{ ... }"
   */
  static isPlaceholder(str: string): boolean {
    const trimmed = str.trim();
    return (
      trimmed === "{...}" ||
      trimmed === "{ ... }" ||
      /^\{\s*\.{3}\s*\}$/.test(trimmed)
    );
  }

  /**
   * Skip over an HTML entity starting at the given position
   * @returns New position after the entity, or original position if no entity found
   */
  static skipHtmlEntity(text: string, pos: number): number {
    if (text[pos] !== "&") {
      return pos;
    }

    const entityMatch = text
      .substring(pos)
      .match(/&(?:quot|apos|amp|lt|gt|#\d+|#x[0-9a-fA-F]+);/i);

    if (entityMatch) {
      return pos + entityMatch[0].length;
    }

    return pos;
  }

  /**
   * Skip over a string literal (with proper escape handling)
   * @returns Position after the closing quote, or -1 if no closing quote found
   */
  static skipString(
    text: string,
    startPos: number,
    quoteChar: string
  ): number {
    let pos = startPos;

    while (pos < text.length) {
      // Check for escape sequence
      if (text[pos] === "\\" && pos + 1 < text.length) {
        pos += 2; // Skip escaped character
        continue;
      }

      // Check for HTML entity
      const entityEnd = this.skipHtmlEntity(text, pos);
      if (entityEnd > pos) {
        pos = entityEnd;
        continue;
      }

      // Check for closing quote
      if (text[pos] === quoteChar) {
        return pos + 1; // Return position after closing quote
      }

      pos++;
    }

    return -1; // No closing quote found
  }

  /**
   * Unescape XML-level quote escaping
   */
  static unescapeXmlQuotes(str: string, quoteChar: string): string {
    if (quoteChar === '"') {
      return str.replace(/\\"/g, '"');
    } else {
      return str.replace(/\\'/g, "'");
    }
  }
}
