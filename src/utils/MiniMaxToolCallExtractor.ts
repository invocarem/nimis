/**
 * MiniMaxToolCallExtractor: Extracts tool calls from MiniMax XML-based responses.
 * Example MiniMax tool call XML:
 * <tool_call>
 *   <name>analyze_latin_batch</name>
 *   <arguments>{"words": ["amo", "amas"]}</arguments>
 * </tool_call>

 */

import type { MCPToolCall } from "./toolCallExtractor";

/**
 * Extracts a MiniMax tool call from an XML string.
 * Returns null if no valid tool call is found.
 */
export function extractMiniMaxToolCall(response: string): MCPToolCall | null {
  // Find <tool_call>...</tool_call>
  const toolCallMatch = response.match(/<tool_call>([\s\S]*?)<\/tool_call>/);
  if (!toolCallMatch) return null;
  const toolCallContent = toolCallMatch[1];

  // Extract <name>...</name>
  const nameMatch = toolCallContent.match(/<name>([\s\S]*?)<\/name>/);
  if (!nameMatch) return null;
  const name = nameMatch[1].trim();

  // Extract <arguments>...</arguments>
  const argsMatch = toolCallContent.match(/<arguments>([\s\S]*?)<\/arguments>/);
  if (!argsMatch) return null;
  const argsStr = argsMatch[1].trim();

  // Try to parse arguments as JSON
  try {
    const args = JSON.parse(argsStr);
    return { name, arguments: args };
  } catch (e) {
    // Fallback: return as string if not valid JSON
    return { name, arguments: argsStr };
  }
}
