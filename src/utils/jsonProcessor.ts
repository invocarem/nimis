// jsonProcessor.ts
export class JsonProcessor {
  /**
   * Safely parse JSON that may contain triple quotes or other edge cases
   * Handles Python-style triple-quoted strings (""") and fixes common LLM JSON issues
   */
  static safeParse(jsonStr: string): any {
    // First, fix cases where LLM outputs \"\" instead of """ for Python docstrings
    jsonStr = this.fixEscapedDoubleQuotes(jsonStr);

    // Then, normalize triple-quoted strings to regular JSON strings
    jsonStr = this.normalizeTripleQuotedStrings(jsonStr);

    // Try standard JSON parsing first
    try {
      return JSON.parse(jsonStr);
    } catch (firstError) {
      // JSON is malformed, likely due to unescaped quotes or literal newlines in content
      // Process character-by-character to fix it
      return this.fixAndParse(jsonStr);
    }
  }

  /**
   * Fixes cases where LLM outputs \"\" (two escaped quotes) at the start of string values
   * when it should be \"\"\" (three escaped quotes) for Python docstrings.
   */
  private static fixEscapedDoubleQuotes(jsonStr: string): string {
    // Match: ": " followed by \"\" (two escaped quotes) then a letter/underscore/newline (start of Python code)
    // In the actual JSON string, \"\" appears as \\"\\" (backslash-quote-backslash-quote)
    // Convert \\"\\" to \\"\\"\\" (add one more escaped quote)
    return jsonStr.replace(/(:\s*")(\\"\\")([a-zA-Z_\n])/g, '$1\\"\\"\\"$3');
  }

  /**
   * Normalizes Python-style triple-quoted strings (""") to regular JSON strings.
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
   * Fix malformed JSON character-by-character and parse it
   */
  private static fixAndParse(jsonStr: string): any {
    let result = '';
    let i = 0;
    let inString = false;
    let expectingKey = false; // Track if next string is a JSON key
    let depth = 0; // Brace depth to track object nesting

    while (i < jsonStr.length) {
      const char = jsonStr[i];
      const next = i < jsonStr.length - 1 ? jsonStr[i + 1] : '';

      // Handle escape sequences
      if (char === '\\' && inString) {
        result += char;
        if (next) {
          result += next;
          i += 2;
        } else {
          i++;
        }
        continue;
      }

      // Track object depth when not in strings
      if (!inString) {
        if (char === '{') {
          depth++;
          expectingKey = true; // After {, we expect a key (or })
          result += char;
          i++;
          continue;
        } else if (char === '}') {
          depth--;
          expectingKey = false;
          result += char;
          i++;
          continue;
        } else if (char === ',' && depth > 0) {
          expectingKey = true; // After , in an object, we expect a key
          result += char;
          i++;
          continue;
        }
      }

      // Handle quotes
      if (char === '"') {
        if (!inString) {
          // Starting a string
          inString = true;
          result += char;
          i++;
          continue;
        } else {
          // Could be end of string OR embedded quote
          // Look ahead to see what follows (skip whitespace, but check for structural characters)
          let j = i + 1;
          // Skip whitespace (spaces, tabs, newlines)
          while (j < jsonStr.length && /\s/.test(jsonStr[j])) {
            j++;
          }
          const nextChar = j < jsonStr.length ? jsonStr[j] : '';

          // Closing quote if:
          // - End of string (no more characters after whitespace)
          // - Followed by : and we're expecting a key
          // - Followed by , } ] (end of value)
          const isClosing =
            nextChar === '' ||
            (nextChar === ':' && expectingKey) ||
            nextChar === ',' ||
            nextChar === '}' ||
            nextChar === ']';

          if (isClosing) {
            // End of string
            inString = false;
            if (nextChar === ':') {
              expectingKey = false; // After :, we expect a value
            }
            result += char;
            i++;
            continue;
          }

          // Embedded quote - escape it
          result += '\\' + char;
          i++;
          continue;
        }
      }

      // Handle control characters inside strings
      if (inString) {
        if (char === '\n') {
          result += '\\n';
        } else if (char === '\r') {
          result += '\\r';
        } else if (char === '\t') {
          result += '\\t';
        } else {
          result += char;
        }
      } else {
        // Outside strings, just copy
        result += char;
      }

      i++;
    }

    // Remove trailing commas
    result = result.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');

    return JSON.parse(result);
  }
  /**
   * Extract JSON tool call from text
   * Returns null if not a valid JSON tool call
   */
  static extractToolCall(
    text: string
  ): { name: string; arguments: any; raw: string } | null {
    try {
      // Try to parse as full JSON object first
      const parsed = JSON.parse(text.trim());
      if (parsed && typeof parsed.name === "string") {
        const args =
          parsed.arguments !== undefined ? parsed.arguments : parsed.args;
        if (args !== undefined) {
          return {
            name: parsed.name,
            arguments: args,
            raw: text.trim(),
          };
        }
      }
    } catch {
      // Not valid JSON, try to find JSON pattern in text
    }

    // Look for JSON tool call pattern in larger text
    const jsonPattern =
      /\{\s*"name"\s*:\s*"([^"]+)"\s*,\s*"(?:arguments|args)"\s*:\s*/;
    const match = text.match(jsonPattern);
    if (!match) return null;

    const startPos = match.index!;
    const argsStartPos = startPos + match[0].length;

    // Find the matching closing brace
    let braceCount = 1;
    let i = argsStartPos;
    let argsEndPos = -1;

    while (i < text.length && braceCount > 0) {
      if (text[i] === "{") braceCount++;
      else if (text[i] === "}") braceCount--;
      if (braceCount === 0) {
        argsEndPos = i;
        break;
      }
      i++;
    }

    if (argsEndPos === -1) return null;

    try {
      const fullJsonStr = text.substring(startPos, argsEndPos + 1);
      const parsed = JSON.parse(fullJsonStr);
      const args =
        parsed.arguments !== undefined ? parsed.arguments : parsed.args;

      return {
        name: parsed.name,
        arguments: args,
        raw: fullJsonStr,
      };
    } catch {
      return null;
    }
  }

  /**
   * Check if text contains a JSON tool call pattern
   */
  static looksLikeToolCall(text: string): boolean {
    return this.extractToolCall(text) !== null;
  }

  // In JsonProcessor.ts, fix extractAllToolCalls:
  static extractAllToolCalls(
    text: string
  ): Array<{ name: string; arguments: any; raw: string }> {
    const results: Array<{ name: string; arguments: any; raw: string }> = [];
    let searchPosition = 0;

    while (searchPosition < text.length) {
      const substring = text.substring(searchPosition);
      const toolCall = this.extractToolCall(substring);

      if (!toolCall) break;

      const actualPosition = text.indexOf(toolCall.raw, searchPosition);
      if (actualPosition === -1) break;

      results.push(toolCall);
      searchPosition = actualPosition + toolCall.raw.length;
    }

    return results;
  }

  /**
   * Validate if JSON is a tool call (has name and arguments/args fields)
   */
  static isValidToolCall(json: any): boolean {
    return (
      json &&
      typeof json === "object" &&
      typeof json.name === "string" &&
      (json.arguments !== undefined || json.args !== undefined)
    );
  }
}
