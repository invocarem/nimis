// xmlProcessor.ts
import * as fs from "fs";
import * as path from "path";
import { HtmlEntityDecoder } from "./htmlEntityDecoder";
import { AttributeParser } from "./parsers/AttributeParser";
import { SimpleQuoteParser } from "./parsers/SimpleQuoteParser";
import { BraceMatchingParser } from "./parsers/BraceMatchingParser";
import { LenientParser } from "./parsers/LenientParser";

export interface XmlToolCall {
  name: string;
  args: any;
  raw: string;
}

export class XmlProcessor {
  private static logDir: string | undefined;
  private static readonly LOG_FILE = "xmlprocessor-debug.log";
  private static readonly MAX_LOG_SIZE = 512 * 1024; // 512KB, rotate after this

  private static parsers: AttributeParser[] = [
    new SimpleQuoteParser(),
    new BraceMatchingParser(),
    new LenientParser(),
  ];

  /**
   * Set the directory for debug log files (typically the .nimis folder).
   * Call once during initialization with the workspace's .nimis path.
   */
  static setLogDir(dir: string): void {
    this.logDir = dir;
  }

  /**
   * Append a debug entry to the log file.
   * Silently ignores write failures to avoid disrupting normal operation.
   */
  private static writeDebugLog(entry: {
    timestamp: string;
    event: string;
    inputLength?: number;
    input?: string;
    error?: string;
    extractedCalls?: number;
    details?: string;
  }): void {
    if (!this.logDir) return;
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
      const logPath = path.join(this.logDir, this.LOG_FILE);

      // Rotate if too large
      if (fs.existsSync(logPath)) {
        const stat = fs.statSync(logPath);
        if (stat.size > this.MAX_LOG_SIZE) {
          const rotatedPath = logPath + ".prev";
          if (fs.existsSync(rotatedPath)) {
            fs.unlinkSync(rotatedPath);
          }
          fs.renameSync(logPath, rotatedPath);
        }
      }

      const separator = "=".repeat(80);
      const lines = [
        separator,
        `[${entry.timestamp}] ${entry.event}`,
      ];
      if (entry.inputLength !== undefined) {
        lines.push(`Input length: ${entry.inputLength} chars`);
      }
      if (entry.error) {
        lines.push(`Error: ${entry.error}`);
      }
      if (entry.extractedCalls !== undefined) {
        lines.push(`Extracted calls: ${entry.extractedCalls}`);
      }
      if (entry.details) {
        lines.push(`Details: ${entry.details}`);
      }
      if (entry.input !== undefined) {
        lines.push("--- RAW INPUT ---");
        lines.push(entry.input);
        lines.push("--- END RAW INPUT ---");
      }
      lines.push("");

      fs.appendFileSync(logPath, lines.join("\n") + "\n", "utf-8");
    } catch {
      // Silently ignore - debug logging must never break normal operation
    }
  }
  /**
   * Extract XML tool calls from text
   */
  static extractToolCalls(text: string): XmlToolCall[] {
    const results: XmlToolCall[] = [];

    // Track all processed positions to avoid duplicate extraction
    const processedPositions: Array<{ start: number; end: number }> = [];

    // Self-closing tool call patterns - support both <tool_call> and <MCP_CALL>
    // Use a more robust approach that handles > characters inside quoted strings
    const selfClosingTagNames = ["tool_call", "MCP_CALL"];

    for (const tagName of selfClosingTagNames) {
      const tagStartPattern = new RegExp(`<${tagName}(?=\\s)`, "g");
      let startMatch: RegExpExecArray | null;

      while ((startMatch = tagStartPattern.exec(text)) !== null) {
        const startPos = startMatch.index;
        const tagEnd = this.findSelfClosingTagEnd(text, startPos, tagName);

        if (tagEnd !== -1) {
          const raw = text.substring(startPos, tagEnd);

          // Extract attributes: everything between <tagName and />
          // Don't use regex - it can match /> inside string values!
          // Instead, use string manipulation since we already found the correct tagEnd
          const tagNameWithBracket = `<${tagName}`;
          const tagStart = raw.indexOf(tagNameWithBracket);
          if (tagStart !== -1) {
            // Find where attributes start (after tagName and any whitespace)
            const attrsStart = tagStart + tagNameWithBracket.length;
            // Use the tagEnd position we found (which is after />) to calculate attrsEnd
            // The attributes end right before the closing />
            const attrsEnd = raw.length - 2; // -2 for "/>"

            if (attrsEnd > attrsStart) {
              const attributes = raw.substring(attrsStart, attrsEnd).trim();

              // Validate that we got reasonable attributes (not truncated)
              // If attributes are suspiciously short compared to raw, it might be incomplete
              if (attributes.length < 20 && raw.length > 100) {
                // This looks like an incomplete tool call - skip it and let incomplete handler deal with it
                continue;
              }

              const parsed = this.parseAttributesWithParsers(
                attributes,
                raw,
                false
              );
              if (parsed) {
                results.push(parsed);
                // Track this processed position
                processedPositions.push({ start: startPos, end: tagEnd });
              }
            }
          }
        }
      }
    }

    // Variant patterns - support both tool_call and MCP_CALL
    // These patterns look for <|...tool_call or |...tool_call variants
    // We'll use a similar approach but look for the variant prefix first
    // Process <| first, then | (but skip if already matched by <|)
    // Note: processedRanges is local to variant patterns, processedPositions tracks all processed ranges
    const processedRanges: Array<{ start: number; end: number }> = [];

    for (const tagName of selfClosingTagNames) {
      // First, look for <|...tool_call pattern
      const variantPattern1 = new RegExp(`<\\|[^<]*${tagName}(?=\\s)`, "g");
      let variantMatch: RegExpExecArray | null;

      while ((variantMatch = variantPattern1.exec(text)) !== null) {
        const variantStart = variantMatch.index;
        const tagStartMatch = text
          .substring(variantStart)
          .match(new RegExp(`${tagName}(?=\\s)`));
        if (tagStartMatch && tagStartMatch.index !== undefined) {
          const tagStartPos = variantStart + tagStartMatch.index;
          const tagEnd = this.findSelfClosingTagEnd(text, tagStartPos, tagName);

          if (tagEnd !== -1) {
            const raw = text.substring(variantStart, tagEnd);
            // Extract attributes
            const attributesMatch = raw.match(
              new RegExp(`${tagName}\\s+(.+?)\\s*/>`, "s")
            );
            if (attributesMatch) {
              const attributes = attributesMatch[1];
              const parsed = this.parseAttributesWithParsers(
                attributes,
                raw,
                false
              );
              if (parsed) {
                results.push(parsed);
                processedRanges.push({ start: variantStart, end: tagEnd });
                processedPositions.push({ start: variantStart, end: tagEnd });
              }
            }
          }
        }
      }

      // Then, look for |...tool_call pattern (but not if it's part of <|)
      const variantPattern2 = new RegExp(
        `(?:^|[^<])\\|[^<]*${tagName}(?=\\s)`,
        "gm"
      );
      variantMatch = null;

      while ((variantMatch = variantPattern2.exec(text)) !== null) {
        const variantStart = variantMatch.index;
        // Skip if this range was already processed by <| pattern
        const isAlreadyProcessed = processedRanges.some(
          (range) => variantStart >= range.start && variantStart < range.end
        );

        if (!isAlreadyProcessed) {
          const tagStartMatch = text
            .substring(variantStart)
            .match(new RegExp(`${tagName}(?=\\s)`));
          if (tagStartMatch && tagStartMatch.index !== undefined) {
            const tagStartPos = variantStart + tagStartMatch.index;
            const tagEnd = this.findSelfClosingTagEnd(
              text,
              tagStartPos,
              tagName
            );

            if (tagEnd !== -1) {
              const raw = text.substring(variantStart, tagEnd);
              // Extract attributes
              const attributesMatch = raw.match(
                new RegExp(`${tagName}\\s+(.+?)\\s*/>`, "s")
              );
              if (attributesMatch) {
                const attributes = attributesMatch[1];
                const parsed = this.parseAttributesWithParsers(
                  attributes,
                  raw,
                  false
                );
                if (parsed) {
                  results.push(parsed);
                  processedPositions.push({ start: variantStart, end: tagEnd });
                }
              }
            }
          }
        }
      }
    }

    // Full element format - support both <tool_call> and <MCP_CALL>
    // Negative lookbehind (?<!\/) prevents matching self-closing tags (/>)
    const fullElementPatterns = [
      /<tool_call[^>]*(?<!\/)>([\s\S]*?)<\/tool_call>/g,
      /<MCP_CALL[^>]*(?<!\/)>([\s\S]*?)<\/MCP_CALL>/g,
    ];

    for (const fullElementRegex of fullElementPatterns) {
      let match: RegExpExecArray | null;
      while ((match = fullElementRegex.exec(text)) !== null) {
        const raw = match[0];
        const matchStart = match.index!;
        const matchEnd = matchStart + raw.length;
        const content = match[1].trim();

        // Skip if this position was already processed
        const isAlreadyProcessed = processedPositions.some(
          (range) => matchStart >= range.start && matchStart < range.end
        );
        if (isAlreadyProcessed) {
          continue;
        }

        try {
          // Try child elements with CDATA first (preferred for code content)
          const nameAttrMatch = raw.match(/<(?:tool_call|MCP_CALL)\s+[^>]*name=["']([^"']+)["']/);
          if (nameAttrMatch) {
            const childArgs = this.parseChildElements(content);
            if (childArgs) {
              results.push({
                raw,
                name: nameAttrMatch[1],
                args: childArgs,
              });
              processedPositions.push({ start: matchStart, end: matchEnd });
              continue;
            }
          }

          // Try to parse JSON content inside element
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const toolData = JSON.parse(jsonMatch[0]);
            const args =
              toolData.arguments !== undefined
                ? toolData.arguments
                : toolData.args;
            if (toolData.name && args !== undefined) {
              results.push({
                raw,
                name: toolData.name,
                args,
              });
              processedPositions.push({ start: matchStart, end: matchEnd });
              continue;
            }
          }

          // Try to extract from attributes
          const attrMatch = raw.match(/<(?:tool_call|MCP_CALL)\s+([^>]+)>/);
          if (attrMatch) {
            const parsed = this.parseAttributesWithParsers(
              attrMatch[1],
              raw,
              false
            );
            if (parsed) {
              results.push(parsed);
              processedPositions.push({ start: matchStart, end: matchEnd });
            }
          }
        } catch (error) {
          // Silently continue on parse error
        }
      }
    }

    // Handle incomplete/truncated tool calls (e.g., when streaming is cut off)
    // Look for <tool_call that appears at the end of text or doesn't have a closing /> or </tool_call>
    // We'll check for patterns that start with <tool_call but don't have proper closing

    // Find all positions where <tool_call or <MCP_CALL appears
    const toolCallStartPattern = /<(?:tool_call|MCP_CALL)(?=\s)/g;
    let startMatch: RegExpExecArray | null;

    while ((startMatch = toolCallStartPattern.exec(text)) !== null) {
      const startPos = startMatch.index;

      // Check if this position was already processed by earlier sections
      const isAlreadyProcessed = processedPositions.some(
        (range) => startPos >= range.start && startPos < range.end
      );

      if (isAlreadyProcessed) {
        continue;
      }

      // Look for closing /> or </tool_call> or </MCP_CALL> after this position
      // Check up to a reasonable distance (e.g., 10000 chars) to avoid scanning entire text
      const searchEnd = Math.min(startPos + 10000, text.length);
      const remainingText = text.substring(startPos, searchEnd);

      // Check if there's a proper closing tag using the same logic as findSelfClosingTagEnd
      // This ensures we only match /> that's actually closing the tag, not one inside JSON
      const tagMatch = remainingText.match(/<(tool_call|MCP_CALL)(?=\s)/);
      const tagName = tagMatch ? tagMatch[1] : 'tool_call';
      const tagStartInRemaining = tagMatch ? tagMatch.index! : 0;
      const properClosingPos = tagMatch ? this.findSelfClosingTagEnd(remainingText, tagStartInRemaining, tagName) : -1;
      const hasSelfClosing = properClosingPos !== -1;
      const hasClosingTag =
        /<\/tool_call>/.test(remainingText) ||
        /<\/MCP_CALL>/.test(remainingText);

      if (hasSelfClosing || hasClosingTag) {
        // This appears to be a complete tool call that our earlier patterns missed
        // But if properClosingPos found a match, use that position
        if (hasSelfClosing && properClosingPos > 0) {
          const raw = remainingText.substring(0, properClosingPos);
          // Extract attributes from the raw string
          const attrsStart = raw.indexOf(' ') + 1;
          const attrsEnd = raw.length - 2; // -2 for "/>"
          if (attrsEnd > attrsStart) {
            const attributes = raw.substring(attrsStart, attrsEnd).trim();
            const parsed = this.parseAttributesWithParsers(
              attributes,
              raw,
              false
            );
            if (parsed) {
              const rawEnd = startPos + properClosingPos;
              results.push(parsed);
              processedPositions.push({ start: startPos, end: rawEnd });
              continue;
            }
          }
        }

        // Fallback: try to extract it using a more lenient pattern
        const lenientMatch = remainingText.match(
          /<(?:tool_call|MCP_CALL)\s+([^>]*?)(?:\s*\/>|>)/
        );
        if (lenientMatch) {
          const attributes = lenientMatch[1];
          const raw = lenientMatch[0];
          const parsed = this.parseAttributesWithParsers(
            attributes,
            raw,
            false
          );
          if (parsed) {
            const rawEnd = startPos + raw.length;
            results.push(parsed);
            processedPositions.push({ start: startPos, end: rawEnd });
            continue;
          }
        }
        // If extraction failed, skip it (might be malformed)
        continue;
      }

      // No closing tag found - this appears to be an incomplete tool call
      // Extract what we can from the remaining text
      const incompleteMatch = remainingText.match(
        /<(?:tool_call|MCP_CALL)\s+(.*)/
      );
      if (incompleteMatch) {
        // Get everything from startPos to end of text as the "raw" incomplete tool call
        const raw = text.substring(startPos);

        // For incomplete tool calls, we need to extract from the full raw string
        // since the JSON might extend beyond what a simple regex can capture
        let parsed: XmlToolCall | null = null;

        // First, try to extract name
        const nameMatch = raw.match(/name\s*=\s*(["'])([^"']+)\1/);
        if (!nameMatch) {
          // No name found, skip this incomplete tool call
          continue;
        }
        const name = nameMatch[2];

        // Try to extract args using brace matching from the raw string
        // This is more robust for incomplete JSON
        if (raw.includes("args='") || raw.includes('args="')) {
          const argsStartMatch = raw.match(/args\s*=\s*(["'])/);
          if (argsStartMatch && argsStartMatch.index !== undefined) {
            const quoteChar = argsStartMatch[1];
            const argsStartPos = argsStartMatch.index + argsStartMatch[0].length;

            // Try to find JSON using brace matching
            let jsonMatch = this.extractJsonFromPosition(raw, argsStartPos);

            // If brace matching failed (JSON is incomplete), try to extract partial JSON
            if (!jsonMatch) {
              // For incomplete JSON, extract everything from argsStartPos to end of raw
              // and try to parse it as partial JSON
              const partialJson = raw.substring(argsStartPos);
              // Remove the closing quote if present at the end
              const cleanedJson = partialJson.trim().replace(/['"]\s*$/, '');

              // Try to parse as partial JSON
              try {
                const args = JSON.parse(cleanedJson);
                parsed = { raw, name, args };
              } catch (e) {
                // JSON is incomplete, try salvage approach below
                jsonMatch = null;
              }
            }

            if (jsonMatch) {
              try {
                const args = JSON.parse(jsonMatch);
                parsed = { raw, name, args };
              } catch (e) {
                // JSON parse failed, try salvage below
              }
            }
          }
        }

        // If we still don't have parsed, try the attribute parser with allowIncomplete
        if (!parsed) {
          // Try to extract attributes using a more lenient approach
          const attributesMatch = raw.match(
            /<(?:tool_call|MCP_CALL)\s+([^>]*?)(?:\s*$|(?=\s|>))/
          );
          const attributes = attributesMatch ? attributesMatch[1] : incompleteMatch[1];
          parsed = this.parseAttributesWithParsers(attributes, raw, true);
        }

        // If that failed and we have args=' or args=" in the raw string, try extracting from raw
        if (!parsed && (raw.includes("args='") || raw.includes('args="'))) {
          // Extract the part after args=' or args="
          const argsStartMatch = raw.match(/args\s*=\s*(["'])/);
          if (argsStartMatch) {
            const quoteChar = argsStartMatch[1];
            const argsStartPos =
              argsStartMatch.index! + argsStartMatch[0].length;
            // Try to find complete JSON using brace matching from this position
            let jsonMatch = this.extractJsonFromPosition(raw, argsStartPos);

            // If brace matching failed (JSON is incomplete), try to extract from raw string directly
            // This handles cases where the JSON is truncated but we can still extract key fields
            if (!jsonMatch) {
              // Extract fields directly from raw string instead of trying to reconstruct JSON
              const filePathMatch = raw.match(/"file_path"\s*:\s*"([^"]+)"/);
              const filePath = filePathMatch ? filePathMatch[1] : null;

              // Extract content - look for "content":" and extract everything until end of raw string
              // or until we find a closing quote followed by } or end of string
              const contentStartMatch = raw.match(/"content"\s*:\s*"/);
              let content = "";
              if (contentStartMatch && contentStartMatch.index !== undefined) {
                const contentStartPos =
                  contentStartMatch.index + contentStartMatch[0].length;
                // Extract from content start to end of raw string (content is truncated)
                const remainingRaw = raw.substring(contentStartPos);
                // Try to find the end of the content string (closing quote that's not escaped)
                let contentEndPos = remainingRaw.length;
                let foundClosingQuote = false;

                for (let i = 0; i < remainingRaw.length; i++) {
                  if (
                    remainingRaw[i] === '"' &&
                    (i === 0 || remainingRaw[i - 1] !== "\\")
                  ) {
                    // Found unescaped closing quote - this might be the end of content
                    // But check if there's more after (like ,} or })
                    const afterQuote = remainingRaw.substring(i + 1).trim();
                    if (
                      afterQuote.startsWith("}") ||
                      afterQuote.startsWith(",}") ||
                      afterQuote.startsWith(", }")
                    ) {
                      contentEndPos = i;
                      foundClosingQuote = true;
                      break;
                    }
                  }
                }

                // If no closing quote found (incomplete content string), look for closing }
                // that would close the JSON object and stop before it
                if (!foundClosingQuote) {
                  // Look backwards from the end for a } that would close the JSON
                  // We want to stop before any } at the end (or followed by just whitespace/quotes)
                  const trimmedRemaining = remainingRaw.trim();
                  const lastBraceIndex = trimmedRemaining.lastIndexOf("}");
                  if (lastBraceIndex >= 0) {
                    // Check if this } is at the end or followed by just whitespace/quotes
                    const afterBrace = trimmedRemaining
                      .substring(lastBraceIndex + 1)
                      .trim();
                    if (
                      afterBrace === "" ||
                      afterBrace === "'" ||
                      afterBrace === '"'
                    ) {
                      // This } closes the JSON object, stop before it
                      const originalIndex =
                        remainingRaw.indexOf(trimmedRemaining) + lastBraceIndex;
                      contentEndPos = originalIndex;
                    }
                  }
                }

                const rawContent = remainingRaw.substring(0, contentEndPos);
                // Unescape JSON string escapes
                content = rawContent
                  .replace(/\\n/g, "\n")
                  .replace(/\\t/g, "\t")
                  .replace(/\\r/g, "\r")
                  .replace(/\\"/g, '"')
                  .replace(/\\'/g, "'")
                  .replace(/\\\\/g, "\\")
                  // Remove XML tag fragments that might have been included
                  .replace(/\s*['"]\s*\}\s*['"]\s*\/>\s*$/, '') // Remove ' }' /> or " }" />
                  .replace(/\s*\}\s*['"]\s*\/>\s*$/, '') // Remove }' /> or }" />
                  .replace(/\s*['"]\s*\/>\s*$/, '') // Remove ' /> or " />
                  .replace(/\s*\/>\s*$/, '') // Remove /> at the end
                  .trim();
              }

              if (filePath || content) {
                // Construct minimal JSON with extracted fields
                const extractedFields: any = {};
                if (filePath) extractedFields.file_path = filePath;
                if (content) extractedFields.content = content;
                jsonMatch = JSON.stringify(extractedFields);
              }
            }

            if (jsonMatch) {
              // Try to construct a minimal attributes string for parsing
              const nameMatch = raw.match(/name\s*=\s*(["'])([^"']+)\1/);
              if (nameMatch) {
                const name = nameMatch[2];
                try {
                  const args = JSON.parse(jsonMatch);
                  parsed = {
                    raw,
                    name,
                    args,
                  };
                } catch (error) {
                  // If JSON parsing still fails, try to extract partial information using regex
                  // This handles cases where JSON is truncated mid-string

                  // Extract file_path if present (for file operations)
                  const filePathMatch = jsonMatch.match(
                    /"file_path"\s*:\s*"([^"]+)"/
                  );
                  const filePath = filePathMatch ? filePathMatch[1] : null;

                  // Extract content - handle incomplete strings
                  // Look for "content":" and extract everything after until end of string or end of jsonMatch
                  const contentStartMatch =
                    jsonMatch.match(/"content"\s*:\s*"/);
                  let content = "";
                  if (contentStartMatch) {
                    const contentStartPos =
                      contentStartMatch.index! + contentStartMatch[0].length;
                    // Extract from content start, but stop before any closing JSON structure
                    // Look for the end of the content string or the first } that would close the JSON
                    let contentEndPos = jsonMatch.length;

                    // Find the first } or ,} that appears after content starts (this closes the JSON object)
                    // But we need to be careful - the } might be part of the content if it's escaped
                    // So we look for } that's not preceded by a backslash
                    for (let i = contentStartPos; i < jsonMatch.length; i++) {
                      // Check for closing brace that's not escaped
                      if (
                        jsonMatch[i] === "}" &&
                        (i === 0 || jsonMatch[i - 1] !== "\\")
                      ) {
                        // Found closing brace - content ends before this
                        contentEndPos = i;
                        break;
                      }
                      // Also check for ,} pattern (comma before closing brace)
                      if (
                        i > 0 &&
                        jsonMatch[i - 1] === "," &&
                        jsonMatch[i] === "}" &&
                        (i === 1 || jsonMatch[i - 2] !== "\\")
                      ) {
                        contentEndPos = i - 1; // Stop before the comma
                        break;
                      }
                    }

                    const rawContent = jsonMatch.substring(
                      contentStartPos,
                      contentEndPos
                    );
                    // Unescape any escaped characters we can see
                    content = rawContent
                      .replace(/\\n/g, "\n")
                      .replace(/\\t/g, "\t")
                      .replace(/\\r/g, "\r")
                      .replace(/\\"/g, '"')
                      .replace(/\\'/g, "'")
                      .replace(/\\\\/g, "\\")
                      // Remove any trailing whitespace or JSON structure that might have leaked in
                      .replace(/\s*[,}]\s*$/, "")
                      // Remove XML tag fragments that might have been included
                      .replace(/\s*['"]\s*\}\s*['"]\s*\/>\s*$/, '') // Remove ' }' /> or " }" />
                      .replace(/\s*\}\s*['"]\s*\/>\s*$/, '') // Remove }' /> or }" />
                      .replace(/\s*['"]\s*\/>\s*$/, '') // Remove ' /> or " />
                      .replace(/\s*\/>\s*$/, '') // Remove /> at the end
                      .trim();
                  }

                  if (filePath || content) {
                    parsed = {
                      raw,
                      name,
                      args: {
                        ...(filePath ? { file_path: filePath } : {}),
                        ...(content !== undefined ? { content: content } : {}),
                      },
                    };
                  } else {
                  }
                }
              }
            }
          }
        }

        if (parsed) {
          results.push(parsed);
        } else {
        }
      }
    }

    if (results.length > 0) {
      console.log(`[XmlProcessor] Found ${results.length} XML tool call(s)`);
    } else if (this.looksLikeXmlToolCall(text)) {
      this.writeDebugLog({
        timestamp: new Date().toISOString(),
        event: "EXTRACT_TOOL_CALLS_FAILED",
        inputLength: text.length,
        input: text,
        extractedCalls: 0,
        details: "Input looks like XML tool call but extraction returned 0 results",
      });
    }
    return results;
  }

  /**
   * Parse attributes from XML tool call using the parser chain
   * This replicates the logic from ToolCallExtractor.parseToolCallAttributes
   * @deprecated Use parseAttributesWithParsers instead
   * @param allowIncomplete If true, be more lenient when parsing incomplete/truncated tool calls
   */
  private static parseAttributes(
    attributes: string,
    raw: string,
    allowIncomplete: boolean = false
  ): XmlToolCall | null {
    return this.parseAttributesWithParsers(attributes, raw, allowIncomplete);
  }

  /**
   * Parse attributes using the strategy pattern with multiple parser implementations
   */
  private static parseAttributesWithParsers(
    attributes: string,
    raw: string,
    allowIncomplete: boolean = false
  ): XmlToolCall | null {
    // Try each parser in order
    for (const parser of this.parsers) {
      if (!parser.canParse(attributes)) {
        continue;
      }

      const result = parser.parse(attributes, allowIncomplete);
      if (result) {
        // Only log successful parsing for debugging if needed
        return {
          raw,
          name: result.name,
          args: result.args,
        };
      }
    }

    // Only warn if this is not an incomplete call attempt (to reduce noise during streaming)
    if (!allowIncomplete) {
      console.warn(
        `[XmlProcessor] Failed to parse tool call attributes (${attributes.length} chars, raw: ${raw.length} chars)`
      );
      this.writeDebugLog({
        timestamp: new Date().toISOString(),
        event: "PARSE_ATTRIBUTES_FAILED",
        inputLength: raw.length,
        input: raw,
        details: `attributes=${attributes.length} chars, allowIncomplete=${allowIncomplete}`,
      });
    }
    return null;
  }

  /**
   * Extract JSON from a specific position in a string using brace matching
   * This is used for incomplete tool calls where the JSON might extend beyond the attributes
   */
  private static extractJsonFromPosition(
    text: string,
    startPos: number
  ): string | null {
    // Find the first opening brace after startPos
    let braceStartPos = startPos;
    while (braceStartPos < text.length && text[braceStartPos] !== "{") {
      braceStartPos++;
    }

    if (braceStartPos >= text.length) {
      return null;
    }

    // Use brace matching to find the closing brace
    let braceCount = 1; // We've already seen the opening {
    let pos = braceStartPos + 1;

    while (pos < text.length && braceCount > 0) {
      const char = text[pos];

      // Handle string literals - skip entire string content
      if (char === '"' || char === "'") {
        const stringStartQuote = char;
        pos++; // Skip opening quote

        // Find the matching closing quote, handling escapes
        while (pos < text.length) {
          if (text[pos] === "\\" && pos + 1 < text.length) {
            // Skip escaped character
            pos += 2;
            continue;
          }

          if (text[pos] === stringStartQuote) {
            // Found closing quote - skip it and break
            pos++;
            break;
          }

          pos++;
        }
        continue;
      }

      // Handle braces (we're outside any string at this point)
      if (char === "{") {
        braceCount++;
      } else if (char === "}") {
        braceCount--;
        if (braceCount === 0) {
          // Found the matching closing brace
          const jsonStr = text.substring(braceStartPos, pos + 1);
          return jsonStr;
        }
      }

      pos++;
    }

    return null;
  }

  /**
   * Extract args attribute value using JSON brace matching (fallback method)
   * This is used when quote-based extraction fails, especially for complex JSON
   * with lots of escaped quotes or special characters.
   */
  private static extractArgsUsingBraceMatching(
    attributes: string
  ): string | null {
    // Look for args=" or args=' followed by {
    // Be lenient - allow whitespace between quote and opening brace
    const argsPattern = /args\s*=\s*(["'])/;
    const match = attributes.match(argsPattern);

    if (!match || !match.index) {
      return null;
    }

    const quoteChar = match[1];
    const argsValueStart = match.index + match[0].length;

    // Find the opening brace after the args=quote
    let jsonStartPos = argsValueStart;
    while (
      jsonStartPos < attributes.length &&
      attributes[jsonStartPos] !== "{"
    ) {
      // Only skip whitespace - if we hit anything else, bail out
      if (!/\s/.test(attributes[jsonStartPos])) {
        return null;
      }
      jsonStartPos++;
    }

    if (jsonStartPos >= attributes.length) {
      return null; // No opening brace found
    }

    // Use brace matching to find the closing brace
    // We need to properly handle strings, escaped characters, and HTML entities
    let braceCount = 1; // We've already seen the opening {
    let pos = jsonStartPos + 1;

    while (pos < attributes.length && braceCount > 0) {
      const char = attributes[pos];

      // Check for HTML entities first (they don't affect JSON structure)
      if (char === "&") {
        const entityMatch = attributes
          .substring(pos)
          .match(/&(?:quot|apos|amp|lt|gt|#\d+|#x[0-9a-fA-F]+);/i);
        if (entityMatch) {
          pos += entityMatch[0].length;
          continue;
        }
      }

      // Handle string literals - skip entire string content
      if (char === '"' || char === "'") {
        const stringStartQuote = char;
        pos++; // Skip opening quote

        // Find the matching closing quote, handling escapes and HTML entities
        while (pos < attributes.length) {
          if (attributes[pos] === "\\" && pos + 1 < attributes.length) {
            // Skip escaped character (could be \" or \' or other escapes)
            pos += 2;
            continue;
          }

          if (attributes[pos] === "&") {
            // Skip HTML entities
            const entityMatch = attributes
              .substring(pos)
              .match(/&(?:quot|apos|amp|lt|gt|#\d+|#x[0-9a-fA-F]+);/i);
            if (entityMatch) {
              pos += entityMatch[0].length;
              continue;
            }
          }

          if (attributes[pos] === stringStartQuote) {
            // Found closing quote - skip it and break
            pos++;
            break;
          }

          pos++;
        }
        continue;
      }

      // Handle braces (we're outside any string at this point)
      if (char === "{") {
        braceCount++;
      } else if (char === "}") {
        braceCount--;
        if (braceCount === 0) {
          // Found the matching closing brace
          const jsonStr = attributes.substring(jsonStartPos, pos + 1);
          return jsonStr;
        }
      }

      pos++;
    }

    return null;
  }

  /**
   * Find the end position of a self-closing tag, handling > characters inside quoted strings
   * Returns the position after the closing />, or -1 if not found
   */
  private static findSelfClosingTagEnd(
    text: string,
    startPos: number,
    tagName: string
  ): number {
    // Start after the opening tag name
    let pos = startPos + tagName.length + 1; // +1 for '<'

    // Track if we're inside quotes (single or double)
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let escapeNext = false;

    // Look for the closing />
    while (pos < text.length) {
      const char = text[pos];

      // Handle escape sequences
      if (escapeNext) {
        escapeNext = false;
        pos++;
        continue;
      }

      if (char === "\\") {
        escapeNext = true;
        pos++;
        continue;
      }

      // Track quote state
      if (char === "'" && !inDoubleQuote) {
        inSingleQuote = !inSingleQuote;
      } else if (char === '"' && !inSingleQuote) {
        inDoubleQuote = !inDoubleQuote;
      }

      // Only check for /> when we're not inside quotes
      if (!inSingleQuote && !inDoubleQuote) {
        // Check for closing />
        if (char === "/" && pos + 1 < text.length && text[pos + 1] === ">") {
          return pos + 2; // Return position after />
        }
      }

      pos++;
    }

    return -1; // Not found
  }

  private static readonly ARRAY_FIELDS = new Set(["commands"]);

  /**
   * Parse child elements from tool call body content.
   * Supports both CDATA-wrapped values and plain text values.
   * Fields listed in ARRAY_FIELDS are returned as string[] (split by newlines
   * for single CDATA, or one entry per CDATA block when multiple are present).
   *
   * Example:
   *   <file_path>src/foo.ts</file_path>
   *   <old_text><![CDATA[const x = "hello";]]></old_text>
   *   <commands><![CDATA[
   *   :e file.ts
   *   :%s/old/new/g
   *   :w
   *   ]]></commands>
   */
  private static parseChildElements(content: string): Record<string, any> | null {
    const args: Record<string, any> = {};
    let foundAny = false;

    // First pass: handle elements that may contain one or more CDATA blocks.
    // Match the full <name>...CDATA...</name> block, then extract CDATA sections within.
    const elementPattern = /<(\w+)>([\s\S]*?)<\/\1>/g;
    let elMatch: RegExpExecArray | null;

    while ((elMatch = elementPattern.exec(content)) !== null) {
      const name = elMatch[1];
      const inner = elMatch[2];

      const cdataValues: string[] = [];
      const cdataInnerPattern = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
      let cdataMatch: RegExpExecArray | null;

      while ((cdataMatch = cdataInnerPattern.exec(inner)) !== null) {
        let value = cdataMatch[1];
        if (value.startsWith('\n')) { value = value.substring(1); }
        if (value.endsWith('\n')) { value = value.substring(0, value.length - 1); }
        cdataValues.push(value);
      }

      if (cdataValues.length > 0) {
        foundAny = true;
        if (this.ARRAY_FIELDS.has(name)) {
          if (cdataValues.length === 1) {
            args[name] = cdataValues[0].split('\n').filter(line => line.trim() !== '');
          } else {
            args[name] = cdataValues.map(v => v.trim()).filter(v => v !== '');
          }
        } else {
          args[name] = cdataValues.join('');
        }
      } else {
        // Plain text (no CDATA inside)
        const plainValue = inner.trim();
        if (plainValue && !(name in args)) {
          foundAny = true;
          if (this.ARRAY_FIELDS.has(name)) {
            args[name] = plainValue.split('\n').filter(line => line.trim() !== '');
          } else {
            args[name] = plainValue;
          }
        }
      }
    }

    return foundAny ? args : null;
  }

  /**
   * Check if text looks like an XML tool call
   */
  static looksLikeXmlToolCall(text: string): boolean {
    return (
      /<tool_call/.test(text) ||
      /<MCP_CALL/.test(text) ||
      /<\|[^>]*tool_call/.test(text) ||
      /<\|[^>]*MCP_CALL/.test(text) ||
      /(?:^|[^<])\|[^>]*tool_call/.test(text) ||
      /(?:^|[^<])\|[^>]*MCP_CALL/.test(text)
    );
  }

  /**
   * Extract reasoning from <think>...</think> tags
   * Returns both the extracted reasoning content and the text with tags removed
   * @param text The text to extract think tags from
   * @returns Object with reasoning array, content without thinks, and hasThinkTags flag
   */
  static extractThinkTags(text: string): {
    reasoning: string[];
    contentWithoutThinks: string;
    hasThinkTags: boolean;
  } {
    const reasoning: string[] = [];
    let contentWithoutThinks = text;

    // Pattern to match <think>...</think>, <thought>...</thought>, or <thinking>...</thinking> tags (case-sensitive, non-greedy)
    // Uses [\s\S] to match any character including newlines
    // Supports <think>, <thought>, and <thinking> tags
    const thinkPattern = /<(think|thought|thinking)>([\s\S]*?)<\/\1>/g;

    let match: RegExpExecArray | null;
    let hasThinkTags = false;

    // Extract all think/thought/thinking tag content
    while ((match = thinkPattern.exec(text)) !== null) {
      hasThinkTags = true;
      const thinkContent = match[2]; // Group 2 is the content (group 1 is the tag name)
      reasoning.push(thinkContent);
    }

    // Remove all think/thought/thinking tags from content
    if (hasThinkTags) {
      contentWithoutThinks = text.replace(
        /<(think|thought|thinking)>[\s\S]*?<\/\1>/g,
        ""
      );
    }

    return {
      reasoning,
      contentWithoutThinks,
      hasThinkTags,
    };
  }
}
