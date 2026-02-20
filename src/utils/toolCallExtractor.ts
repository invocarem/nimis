/**
 * Preprocesses a JSON-like string to make it safe for JSON.parse.
 * Handles literal newlines and unescaped quotes in string values.
 * Also handles Python-style triple-quoted strings (""") by converting them to regular JSON strings.
 * Also fixes cases where LLM outputs \"\" (two escaped quotes) instead of """ (triple quotes).
 */
export function safeJsonParse(jsonStr: string): any {
  // First, fix cases where LLM outputs \"\" instead of """ for Python docstrings
  jsonStr = fixEscapedDoubleQuotes(jsonStr);

  // Then, normalize triple-quoted strings to regular JSON strings
  // This handles cases where LLM outputs """...""" instead of "..." with escaped quotes
  jsonStr = normalizeTripleQuotedStrings(jsonStr);

  // Try standard JSON parsing first
  try {
    return JSON.parse(jsonStr);
  } catch (firstError) {
    // JSON is malformed, likely due to unescaped quotes or literal newlines in content
    // Process character-by-character to fix it

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
}

/**
 * Fixes cases where LLM outputs \"\" (two escaped quotes) at the start of string values
 * when it should be \"\"\" (three escaped quotes) for Python docstrings.
 * 
 * Problem: LLM outputs "old_text": "\"\"def add..." instead of "old_text": "\"\"\"def add..."
 * Solution: Find \"\" immediately after ": " and before code starts, convert to \"\"\"
 * 
 * This must be done BEFORE JSON parsing to preserve the correct format.
 */
function fixEscapedDoubleQuotes(jsonStr: string): string {
  // Match: ": " followed by \"\" (two escaped quotes) then a letter/underscore/newline (start of Python code)
  // In the actual JSON string, \"\" appears as \\"\\" (backslash-quote-backslash-quote)
  // Convert \\"\\" to \\"\\"\\" (add one more escaped quote)
  // Only match when \"\" appears right after the opening quote of a value
  // Pattern: ": " then \" then \" then a letter/underscore/newline
  return jsonStr.replace(/(:\s*")(\\"\\")([a-zA-Z_\n])/g, '$1\\"\\"\\"$3');
}

/**
 * Normalizes Python-style triple-quoted strings (""") to regular JSON strings.
 * Preserves all whitespace and content exactly.
 * Example: """text""" -> "text" (with proper escaping of internal quotes)
 */
function normalizeTripleQuotedStrings(jsonStr: string): string {
  // Quick check: if no triple quotes exist, return as-is
  if (!jsonStr.includes('"""')) {
    return jsonStr;
  }

  let result = '';
  let i = 0;
  let inTripleQuote = false;
  let tripleQuoteStart = -1;

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
        tripleQuoteStart = i;
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
      // (but not if it's part of the closing """)
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

// Utility to robustly extract tool calls from LLM responses.
// Supports tool_call(name="...", arguments={...}) or tool_call(tool_name="...", args={...})
// Handles large/complex JSON arguments.

import { extractMiniMaxToolCall } from "./MiniMaxToolCallExtractor";
import { extractHarmonyToolCall } from "./HarmonyToolCallExtractor";
import { JsonProcessor } from "./jsonProcessor";
// Export format-specific extractors for external use
export { extractMiniMaxToolCall, extractHarmonyToolCall };

export interface MCPToolCall {
  name: string;
  arguments: any;
}
