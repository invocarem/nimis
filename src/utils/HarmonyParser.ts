import { extractHarmonyToolCall, extractQwen3ToolCalls, MCPToolCall } from "./toolCallExtractor";
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
      // Match Harmony tags <|tag|> and extract content until next Harmony tag or end
      // The lookahead (?=<\|[\w]+\|>|$) ensures we only stop at Harmony tags (<|...|>), not at other < characters
      // This prevents issues when message content contains XML tags like <tool_call>
      // Note: Content after <|message|> or <|final|> includes everything until <|end|>, preserving any <|tag|> patterns as literal text
      const tagRegex = /<\|(\w+)\|>([\s\S]*?)(?=<\|[\w]+\|>|$)/gs;
      let match;
      let currentChannel = "";
      let blockMessage = "";
      let blockChannels: string[] = [];
      let messageStartIndex = -1; // Track where message content starts
      
      while ((match = tagRegex.exec(content)) !== null) {
        const tag = match[1];
        const tagStart = match.index;
        const value = match[2].trim();
        
        switch (tag) {
          case "channel":
            currentChannel = value;
            if (!channels.includes(value)) channels.push(value);
            if (!blockChannels.includes(value)) blockChannels.push(value);
            messageStartIndex = -1; // Reset message tracking
            break;
          case "message":
          case "final":
            // Extract everything from after <|message|> or <|final|> until <|end|> or end of block
            // This preserves any <|tag|> patterns that appear in the message content
            messageStartIndex = tagStart + match[0].length; // Position after the tag
            break;
          case "end":
            // If we were collecting message content, extract everything from messageStartIndex to here
            if (messageStartIndex >= 0) {
              const messageContent = content.substring(messageStartIndex, tagStart).trim();
              blockMessage += messageContent + " ";
              messageStartIndex = -1;
            }
            break;
          default:
            if (tag !== "assistant") {
              metadata[tag] = value;
            }
        }
      }
      
      // If we started collecting message content but didn't find <|end|>, extract to end of block
      if (messageStartIndex >= 0) {
        const messageContent = content.substring(messageStartIndex).trim();
        blockMessage += messageContent + " ";
      }
      blockMessage = blockMessage.trim();
      if (blockMessage) {
        lastMessage = blockMessage;
        lastChannels = blockChannels;
      }
    }
    // If we found a message in any block, use the last one; else fallback
    finalMessage = lastMessage || input;
    
    // Strip tool call markers from message content (they should not appear in user-facing content)
    // Remove patterns like "assistantanalysis to=vim code{", "to=vim code{", "to=vim json{", etc.
    // This handles cases where tool call markers leak into message content
    finalMessage = finalMessage.replace(/\s*(?:assistant\w*\s+)?to=\w+\s+(?:code|json)\s*\{[^}]*\}/g, '');
    finalMessage = finalMessage.replace(/\s*(?:assistant\w*\s+)?to=\w+\s+(?:code|json)\s*\{[^}]*$/, '');

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

    // Try Qwen3 format (<function=name> <parameter=name>value</parameter>)
    const qwen3Calls = extractQwen3ToolCalls(response);
    if (qwen3Calls.length > 0) return qwen3Calls;

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
