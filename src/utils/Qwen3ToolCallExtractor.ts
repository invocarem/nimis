/**
 * Qwen3ToolCallExtractor: Extracts tool calls from Qwen3 XML-based responses.
 * Qwen3 (and vLLM StreamingXMLToolCallParser) use this format:
 *
 * <tool_call>
 *   <function=file_glob_search>
 *   <parameter=pattern> gotx-op.xml </parameter>
 * </tool_call>
 *
 * - <function=NAME> — function/tool name (self-closing or with child parameters)
 * - <parameter=NAME> value </parameter> — parameter name in tag, value in body
 */

import type { MCPToolCall } from "./toolCallExtractor";

/** Quick check: does the string look like Qwen3 format (has <function= inside <tool_call>)? */
function looksLikeQwen3ToolCall(text: string): boolean {
  return /<tool_call\b[\s\S]*?<function=/.test(text);
}

/**
 * Parses a single parameter value: trim, and try JSON parse if it looks like JSON.
 */
function parseParameterValue(val: string): unknown {
  const trimmed = val.trim();
  if (trimmed === "") return trimmed;
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

/**
 * Extracts all Qwen3-style tool calls from a response string.
 * Returns empty array if none found.
 */
export function extractQwen3ToolCalls(response: string): MCPToolCall[] {
  if (!looksLikeQwen3ToolCall(response)) return [];

  const results: MCPToolCall[] = [];
  const wrapperRegex = /<tool_call\b[^>]*>([\s\S]*?)<\/tool_call>/gi;
  let match: RegExpExecArray | null;

  while ((match = wrapperRegex.exec(response)) !== null) {
    const inner = match[1];
    const toolCall = parseSingleQwen3ToolCall(inner);
    if (toolCall) results.push(toolCall);
  }

  return results;
}

/**
 * Extracts the first Qwen3 tool call from a response string.
 * Returns null if no valid tool call is found.
 */
export function extractQwen3ToolCall(response: string): MCPToolCall | null {
  const calls = extractQwen3ToolCalls(response);
  return calls.length > 0 ? calls[0] : null;
}

/**
 * Parses the inner content of a single <tool_call>...</tool_call> block.
 */
function parseSingleQwen3ToolCall(inner: string): MCPToolCall | null {
  // Extract function name: <function=name> or <function=name/>
  const funcMatch = inner.match(/<function=([^>\s/]+)(?:\s*\/?>|>)/);
  if (!funcMatch) return null;
  const name = funcMatch[1].trim();

  const args: Record<string, unknown> = {};

  // Extract parameters: <parameter=paramName> value </parameter> or <parameter=paramName> value (no closing tag)
  // Value runs until </parameter>, or next <parameter=, </tool_call>, <function=, or end
  const paramRegex = /<parameter=([^>\s]+)\s*>([\s\S]*?)(?=<\/parameter>|<parameter=|<\/tool_call>|<function=|\s*$)/gi;
  let paramMatch: RegExpExecArray | null;
  while ((paramMatch = paramRegex.exec(inner)) !== null) {
    const paramName = paramMatch[1].trim();
    const paramValue = paramMatch[2];
    args[paramName] = parseParameterValue(paramValue);
  }

  return { name, arguments: args };
}
