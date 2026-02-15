import { HarmonyParser, ParsedResponse } from "./HarmonyParser";
import { MCPToolCall } from "./toolCallExtractor";

/**
 * Class for parsing LLM responses into structured format
 * Now delegates to HarmonyParser for the main parsing logic
 */
export class ResponseParser {
  /**
   * Parse raw LLM response into structured ParsedResponse
   * Extracts reasoning, tool calls, and user-facing content
   */
  static parse(rawResponse: string): ParsedResponse {
    // Delegate to HarmonyParser which now returns ParsedResponse
    return HarmonyParser.parse(rawResponse);
  }
  
  /**
   * Check if response contains any tool calls
   */
  static hasToolCalls(response: ParsedResponse): boolean {
    return response.tool_calls !== undefined && response.tool_calls.length > 0;
  }
  
  /**
   * Get the first tool call if any exists
   */
  static getFirstToolCall(response: ParsedResponse): MCPToolCall | undefined {
    return response.tool_calls?.[0];
  }
}

// Re-export ParsedResponse for convenience
export type { ParsedResponse };
