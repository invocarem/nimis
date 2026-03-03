/**
 * HarmonyToolCallExtractor: Extracts tool calls from OpenAI Harmony format responses.
 * Example Harmony tool call:
 * <|start|>assistant<|channel|>analysis to=tool_call code<|message|>{\n  "name": "analyze_latin",\n  "arguments": {\n    "word": "invenietur"\n  }\n}\n\n
 */

import type { MCPToolCall } from "./toolCallExtractor";
import { JsonProcessor } from "./jsonProcessor";

const HARMONY_MARKER = "to=tool_call code<|message|>";

/** Matches OpenAI Harmony spec: "to=vim <|constrain|>json<|message|>{" */
const HARMONY_CONSTRAIN_JSON_REGEX = /to=([\w.]+)\s+<\|constrain\|>json<\|message\|>\s*\{/;

/** Matches Harmony variant: "commentary to=vim json{" or "to=vim json{" */
const HARMONY_TO_JSON_REGEX = /(?:^|[\s"])to=(\w+)\s+json(?:<\|message\|>)?\s*\{/;

/** Matches Harmony variant: "to=vim code{", "to=vim code<|message|>{" */
const HARMONY_TO_CODE_REGEX = /to=(\w+)\s+code(?:<\|message\|>)?\s*\{/;

/**
 * Extracts a Harmony tool call from a response string.
 * Supports four formats:
 * 1. Standard: to=tool_call code<|message|>{"name": "...", "arguments": {...}}
 * 2. OpenAI spec: to=<toolname> <|constrain|>json<|message|>{...}
 * 3. Variant: to=<toolname> code{...} — tool name in "to=", JSON is args directly
 * 4. Variant: to=<toolname> json{...} — tool name in "to=", JSON is args directly
 * Returns null if no valid tool call is found.
 */
export function extractHarmonyToolCall(response: string): MCPToolCall | null {
  // Try standard format first
  const standard = extractStandardFormat(response);
  if (standard) return standard;

  // Try OpenAI Harmony spec: to=<name> <|constrain|>json<|message|>{...}
  const constrainFormat = extractConstrainJsonFormat(response);
  if (constrainFormat) return constrainFormat;

  // Try "to=vim code{...}" format
  const codeFormat = extractToCodeFormat(response);
  if (codeFormat) return codeFormat;

  // Fallback: Harmony variant "to=vim json{...}"
  return extractToJsonFormat(response);
}

function extractStandardFormat(response: string): MCPToolCall | null {
  const markerIdx = response.indexOf(HARMONY_MARKER);
  if (markerIdx === -1) return null;

  const afterMarker = response.slice(markerIdx + HARMONY_MARKER.length);
  const jsonStart = afterMarker.indexOf("{");
  if (jsonStart === -1) return null;

  const jsonStr = extractBalancedBraces(afterMarker, jsonStart);
  if (!jsonStr) return null;

  try {
    const parsed = JsonProcessor.safeParse(jsonStr);
    const name = parsed?.name;
    const args = parsed?.arguments;
    if (name == null) return null;
    return { name, arguments: args ?? {} };
  } catch {
    return null;
  }
}

function extractConstrainJsonFormat(response: string): MCPToolCall | null {
  const match = response.match(HARMONY_CONSTRAIN_JSON_REGEX);
  if (!match) return null;

  const toolNameRaw = match[1];
  // Strip "functions." prefix if present (e.g. functions.vim -> vim)
  const toolName = toolNameRaw.startsWith("functions.")
    ? toolNameRaw.slice("functions.".length)
    : toolNameRaw;

  const jsonStartIdx = match.index! + match[0].length - 1; // index of "{"
  const jsonStr = extractBalancedBraces(response, jsonStartIdx);
  if (!jsonStr) return null;

  try {
    const args = JsonProcessor.safeParse(jsonStr);
    return { name: toolName, arguments: args ?? {} };
  } catch {
    return null;
  }
}

function extractToCodeFormat(response: string): MCPToolCall | null {
  const match = response.match(HARMONY_TO_CODE_REGEX);
  if (!match) return null;

  const toolName = match[1];
  if (toolName === "tool_call") return null;
  const jsonStartIdx = match.index! + match[0].length - 1; // index of "{"
  const jsonStr = extractBalancedBraces(response, jsonStartIdx);
  if (!jsonStr) return null;

  try {
    const args = JsonProcessor.safeParse(jsonStr);
    return { name: toolName, arguments: args ?? {} };
  } catch {
    return null;
  }
}

function extractToJsonFormat(response: string): MCPToolCall | null {
  const match = response.match(HARMONY_TO_JSON_REGEX);
  if (!match) return null;

  const toolName = match[1];
  const jsonStartIdx = match.index! + match[0].length - 1; // index of "{"
  const jsonStr = extractBalancedBraces(response, jsonStartIdx);
  if (!jsonStr) return null;

  try {
    const args = JsonProcessor.safeParse(jsonStr);
    return { name: toolName, arguments: args ?? {} };
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
