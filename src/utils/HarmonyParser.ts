import { extractToolCall, extractHarmonyToolCall, MCPToolCall } from "./toolCallExtractor";
import { XmlProcessor } from "./xmlProcessor";

/**
 * Interface for the result of parsing a Harmony protocol message
 * @deprecated Use ParsedResponse instead
 */
export interface ParsedHarmonyMessage {
  finalMessage: string;
  channels: string[];
  metadata: Record<string, any>;
}

/**
 * Interface for structured LLM response after parsing
 */
export interface ParsedResponse {
  reasoning?: string;      // The thinking/reasoning content
  tool_calls?: MCPToolCall[];  // Tool requests (supporting multiple calls)
  content: string;         // Final user-facing content
  raw: string;             // Original response
}

/**
 * Class for parsing Harmony protocol messages
 * The Harmony protocol uses tags like <|start|>, <|channel|>, <|message|>, <|final|>, <|end|> to structure content
 */
export class HarmonyParser {
  /**
   * Parse a Harmony protocol string and extract reasoning, tool calls, and final content
   */
  static parse(input: string): ParsedResponse {
    // If no Harmony start tag, treat as plain text
    if (!input.includes("<|start|>")) {
      const reasoning = this.extractReasoning(input, [], {});
      const tool_calls = this.extractToolCalls(input);
      // Send raw content - client will handle all formatting
      const content = input;

      return {
        reasoning,
        tool_calls: tool_calls.length > 0 ? tool_calls : undefined,
        content,
        raw: input,
      };
    }

    const channels: string[] = [];
    const metadata: Record<string, any> = {};
    let finalMessage = "";

    // Split input into message blocks by <|start|>; allow partial (streaming) blocks without <|end|>
    const messageBlocks = input.split(/<\|start\|>/g).filter(Boolean);
    let lastMessage = "";
    let lastChannels: string[] = [];
    for (const block of messageBlocks) {
      // For streaming, the last block may not have <|end|> yet; still parse it
      const content = block.includes("<|end|>")
        ? block.split(/<\|end\|>/)[0]
        : block;
      const tagRegex = /<\|(\w+)\|>(.*?)(?=<\|[\w]+\|>|$)/gs;
      let match;
      let currentChannel = "";
      let blockMessage = "";
      let blockChannels: string[] = [];
      while ((match = tagRegex.exec(content)) !== null) {
        const tag = match[1];
        const value = match[2].trim();
        switch (tag) {
          case "channel":
            currentChannel = value;
            if (!channels.includes(value)) channels.push(value);
            if (!blockChannels.includes(value)) blockChannels.push(value);
            break;
          case "message":
          case "final":
            blockMessage += value + " ";
            break;
          default:
            if (tag !== "assistant") {
              metadata[tag] = value;
            }
        }
      }
      blockMessage = blockMessage.trim();
      if (blockMessage) {
        lastMessage = blockMessage;
        lastChannels = blockChannels;
      }
    }
    // If we found a message in any block, use the last one; else fallback
    finalMessage = lastMessage || input;

    // Extract reasoning from channels or tags
    const reasoning = this.extractReasoning(input, channels, metadata);

    // Extract tool calls
    const tool_calls = this.extractToolCalls(input);

    // Send raw content - client will handle all formatting
    const content = finalMessage.trim();

    return {
      reasoning,
      tool_calls: tool_calls.length > 0 ? tool_calls : undefined,
      content,
      raw: input,
    };
  }

  /**
   * Extract reasoning/thinking content from response
   * Looks for content between <thinking> tags or similar patterns
   */
  private static extractReasoning(response: string, channels: string[], metadata: Record<string, any>): string | undefined {
    // Look for thinking tags (common in various LLM outputs)
    const thinkingMatch = response.match(/<thinking>(.*?)<\/thinking>/s);
    if (thinkingMatch) {
      return thinkingMatch[1].trim();
    }

    // Look for reasoning tags
    const reasoningMatch = response.match(/<reasoning>(.*?)<\/reasoning>/s);
    if (reasoningMatch) {
      return reasoningMatch[1].trim();
    }

    // Look for Harmony channel="think" or channel="reasoning"
    const thinkChannelMatch = response.match(/<\|channel\|>think<\|message\|>(.*?)(?=<\|channel\|>|<\|end\|>)/s);
    if (thinkChannelMatch) {
      return thinkChannelMatch[1].trim();
    }

    const reasoningChannelMatch = response.match(/<\|channel\|>reasoning<\|message\|>(.*?)(?=<\|channel\|>|<\|end\|>)/s);
    if (reasoningChannelMatch) {
      return reasoningChannelMatch[1].trim();
    }

    return undefined;
  }

  /**
   * Extract all tool calls from response (supports multiple)
   * Returns array of tool calls in order they appear
   */
  private static extractToolCalls(response: string): MCPToolCall[] {
    const toolCalls: MCPToolCall[] = [];

    // Try Harmony format first (to=tool_call code<|message|>{...})
    const harmonyMarker = "to=tool_call code<|message|>";
    let searchStart = 0;
    while (true) {
      const slice = response.slice(searchStart);
      const toolCall = extractHarmonyToolCall(slice);
      if (!toolCall) break;
      toolCalls.push(toolCall);
      const nextMarker = response.indexOf(harmonyMarker, searchStart + harmonyMarker.length);
      if (nextMarker === -1) break;
      searchStart = nextMarker;
    }
    if (toolCalls.length > 0) return toolCalls;

    // Try XML format using XmlProcessor (preferred for robust JSON parsing)
    if (XmlProcessor.looksLikeXmlToolCall(response)) {
      const xmlToolCalls = XmlProcessor.extractToolCalls(response);
      if (xmlToolCalls.length > 0) {
        // Convert XmlToolCall[] to MCPToolCall[] (args -> arguments)
        return xmlToolCalls.map(xmlCall => ({
          name: xmlCall.name,
          arguments: xmlCall.args || {}
        }));
      }
    }

    // Fallback: find all tool_call( patterns in the response (deprecated, kept for backward compatibility)
    let searchString = response;
    while (true) {
      const callStart = searchString.indexOf("tool_call(");
      if (callStart === -1) break;

      const remaining = searchString.slice(callStart);
      const toolCall = extractToolCall(remaining);

      if (toolCall) {
        toolCalls.push(toolCall);
        const callEnd = remaining.indexOf(")", remaining.indexOf("tool_call(")) + 1;
        searchString = remaining.slice(callEnd);
      } else {
        searchString = searchString.slice(callStart + "tool_call(".length);
      }
    }

    return toolCalls;
  }

  /**
   * Legacy method for backward compatibility
   * @deprecated Use parse() instead which returns ParsedResponse
   */
  static parseLegacy(input: string): ParsedHarmonyMessage {
    const parsed = this.parse(input);
    return {
      finalMessage: parsed.content,
      channels: [],
      metadata: {},
    };
  }
}
