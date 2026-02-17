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
  // Match <tool_call> or namespaced <xxx:tool_call>
  const wrapperMatch = response.match(/<(?:\w+:)?tool_call\b[^>]*>([\s\S]*?)<\/(?:\w+:)?tool_call>/i);
  if (!wrapperMatch) return null;
  const toolCallContent = wrapperMatch[1];

  // 1) Old-style XML: <name>...</name> + <arguments>...</arguments>
  const nameTagMatch = toolCallContent.match(/<(?:\w+:)?name\b[^>]*>([\s\S]*?)<\/(?:\w+:)?name>/i);
  const argsTagMatch = toolCallContent.match(/<(?:\w+:)?arguments\b[^>]*>([\s\S]*?)<\/(?:\w+:)?arguments>/i);
  if (nameTagMatch && argsTagMatch) {
    const name = nameTagMatch[1].trim();
    const argsStr = argsTagMatch[1].trim();
    try {
      const args = JSON.parse(argsStr);
      return { name, arguments: args };
    } catch (e) {
      return { name, arguments: argsStr };
    }
  }

  // 2) Support <invoke name="..."> with multiple <parameter name="...">value</parameter>
  const invokeMatch = toolCallContent.match(/<(?:\w+:)?invoke\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?invoke>/i);
  if (invokeMatch) {
    const invokeAttrs = invokeMatch[1];
    const invokeBody = invokeMatch[2];
    const invokeNameMatch = invokeAttrs.match(/name\s*=\s*"([^"]+)"/i);
    if (!invokeNameMatch) return null;
    const name = invokeNameMatch[1];

    const params: Record<string, any> = {};
    const paramRe = /<(?:\w+:)?parameter\b[^>]*name\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/(?:\w+:)?parameter>/gi;
    let m: RegExpExecArray | null;
    while ((m = paramRe.exec(invokeBody)) !== null) {
      const key = m[1];
      let val = m[2].trim();
      // Try to parse as JSON; if fails, keep as string (allows multiline text)
      try {
        val = JSON.parse(val);
      } catch (e) {
        // leave as string
      }
      params[key] = val;
    }

    return { name, arguments: params };
  }

  // 3) Fallback: try to parse inner content as a JSON object with name/arguments keys
  try {
    const maybe = JSON.parse(toolCallContent.trim());
    if (maybe && typeof maybe === "object" && typeof maybe.name === "string") {
      return { name: maybe.name, arguments: maybe.arguments ?? null };
    }
  } catch (e) {
    // ignore
  }

  return null;
}
