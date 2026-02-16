/**
 * HarmonyToolCallExtractor: Extracts tool calls from OpenAI Harmony format responses.
 * Example Harmony tool call:
 * <|start|>assistant<|channel|>analysis to=tool_call code<|message|>{\n  "name": "analyze_latin",\n  "arguments": {\n    "word": "invenietur"\n  }\n}\n\n
 */

import type { MCPToolCall } from "./toolCallExtractor";

const HARMONY_MARKER = "to=tool_call code<|message|>";

/**
 * Extracts a Harmony tool call from a response string.
 * Returns null if no valid tool call is found.
 */
export function extractHarmonyToolCall(response: string): MCPToolCall | null {
  const markerIdx = response.indexOf(HARMONY_MARKER);
  if (markerIdx === -1) return null;

  const afterMarker = response.slice(markerIdx + HARMONY_MARKER.length);
  const jsonStart = afterMarker.indexOf("{");
  if (jsonStart === -1) return null;

  const jsonStr = extractBalancedBraces(afterMarker, jsonStart);
  if (!jsonStr) return null;

  try {
    const parsed = JSON.parse(jsonStr);
    const name = parsed?.name;
    const args = parsed?.arguments;
    if (name == null) return null;
    return { name, arguments: args ?? {} };
  } catch {
    return null;
  }
}

/**
 * From the given string and index of the first '{', returns the substring
 * up to the matching '}', respecting nested braces and strings.
 */
function extractBalancedBraces(str: string, start: number): string | null {
  let depth = 0;
  let i = start;
  let inString = false;
  let escape = false;
  let quoteChar = '"';

  while (i < str.length) {
    const ch = str[i];

    if (escape) {
      escape = false;
      i++;
      continue;
    }
    if (ch === "\\" && inString) {
      escape = true;
      i++;
      continue;
    }
    if (inString) {
      if (ch === quoteChar) inString = false;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quoteChar = ch;
      i++;
      continue;
    }
    if (ch === "{") {
      depth++;
      i++;
      continue;
    }
    if (ch === "}") {
      depth--;
      if (depth === 0) return str.slice(start, i + 1);
      i++;
      continue;
    }
    i++;
  }
  return null;
}
