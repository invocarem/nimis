import { HarmonyParser } from "./HarmonyParser";

export interface FormatOptions {
  enableSyntaxHighlight?: boolean;
  enableJsonFormatting?: boolean;
  enableMarkdown?: boolean;
}

/**
 * Class for processing and formatting LLM response output
 */
export class LLMResponseProcessor {
  private options: Required<FormatOptions>;

  private static preprocessLLMOutput(text: string): string {
    let processed = text;

    // Add line breaks before common section headers to help parsing
    processed = processed.replace(/(Features:|Usage:|Output:|Would you like)/g, "\n$1");

    // Fix malformed code blocks with language on separate line
    const inputLines = processed.split("\n");
    let outputLines: string[] = [];
    let lineIndex = 0;

    while (lineIndex < inputLines.length) {
      const currentLine = inputLines[lineIndex].trim();
      const nextLine = inputLines[lineIndex + 1] || "";

      // Check if this line is just a language name and next line starts with code
      if (
        currentLine &&
        !currentLine.includes(" ") &&
        !currentLine.startsWith("#") &&
        !currentLine.startsWith("-") &&
        !currentLine.startsWith("*") &&
        nextLine &&
        (nextLine.includes("def ") ||
          nextLine.includes("class ") ||
          nextLine.includes("import ") ||
          nextLine.includes("from ") ||
          nextLine.includes("function ") ||
          nextLine.match(/^\w+\s*=/) ||
          nextLine.match(/^\w+\s*\(/))
      ) {
        // Found a language line followed by code, wrap it
        let codeLines: string[] = [];
        let codeIndex = lineIndex + 1;

        // Collect code lines until we hit a clear non-code indicator
        while (codeIndex < inputLines.length) {
          const codeLine = inputLines[codeIndex];
          if (
            codeLine.match(/^[A-Z][^:]*:/) ||
            codeLine.startsWith("- ") ||
            codeLine.match(/^\d+\. /)
          ) {
            break;
          }
          codeLines.push(codeLine);
          codeIndex++;
        }

        if (codeLines.length > 0) {
          outputLines.push("```" + currentLine);
          outputLines.push(...codeLines);
          outputLines.push("```");
          lineIndex = codeIndex - 1; // Skip the code lines we just processed
        } else {
          outputLines.push(inputLines[lineIndex]);
        }
      } else {
        outputLines.push(inputLines[lineIndex]);
      }
      lineIndex++;
    }

    processed = outputLines.join("\n");

    // Fix malformed code block starts like "python# hello.py" -> "```python\n# hello.py"
    // Handle concatenated code by finding the end patterns first
    processed = processed.replace(
      /(\w+)#\s*([^]*?)(This creates:|Usage:|Output:|Save this as|Would you like)/g,
      (match, lang, code, endMarker) => {
        return (
          "```" + lang.trim() + "\n# " + code.trim() + "\n```\n\n" + endMarker
        );
      }
    );

    // Handle cases where the pattern doesn't match end markers - fallback to original approach
    processed = processed.replace(/(\w+)#(\s*)(.+)$/gm, "```$1\n# $3");

    // Fix cases where language is directly followed by code like "python def greet..."
    processed = processed.replace(
      /^(\w+)(def |class |import |from |function |\w+\s*= |\w+\s*\()/gm,
      "```$1\n$2"
    );
    // Fix common LLM typos inside code blocks (avoid adding newlines - can corrupt valid code)
    processed = processed.replace(
      /```(\w+)([\s\S]*?)```/g,
      (match, lang, code) => {
        let formattedCode = code.replace(
          /if name == "main":/g,
          'if __name__ == "__main__":'
        );
        return "```" + lang.trim() + "\n" + formattedCode.trim() + "\n```";
      }
    );
    // Fix malformed bash commands like "bashpython hello.py" -> "```bash\npython hello.py"
    processed = processed.replace(/^bash(\w.+)$/gm, "```bash\n$1");

    // Fix cases where code blocks don't have proper closing ```
    // Look for patterns where a new section starts after code without closing ```
    const lines = processed.split("\n");
    let inCodeBlock = false;
    let result: string[] = [];
    let codeBuffer: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const nextLine = lines[i + 1] || "";

      // Check if this looks like the start of a code block
      if (!inCodeBlock && /^(\w+)# /.test(line)) {
        // Already handled above, but just in case
        inCodeBlock = true;
        codeBuffer = [line];
      } else if (!inCodeBlock && /^```/.test(line)) {
        inCodeBlock = true;
        codeBuffer = [line];
      } else if (inCodeBlock) {
        codeBuffer.push(line);

        // Check if we should close the code block
        // Close if next line is empty or starts a new section (like "Usage:", "## ", etc.)
        if (
          !nextLine ||
          nextLine.trim() === "" ||
          /^#{1,6} /.test(nextLine) ||
          /^[A-Z][^:]*:/.test(nextLine) ||
          /^- /.test(nextLine) ||
          /^\d+\. /.test(nextLine) ||
          /^With /.test(nextLine) ||
          /^Would /.test(nextLine) ||
          /^# Output/.test(nextLine)
        ) {
          // Close the code block
          if (!codeBuffer[codeBuffer.length - 1].trim().endsWith("```")) {
            codeBuffer.push("```");
          }
          result.push(...codeBuffer);
          inCodeBlock = false;
          codeBuffer = [];
        }
      } else {
        result.push(line);
      }
    }

    // Handle any remaining code buffer
    if (codeBuffer.length > 0) {
      if (!codeBuffer[codeBuffer.length - 1].trim().endsWith("```")) {
        codeBuffer.push("```");
      }
      result.push(...codeBuffer);
    }

    processed = result.join("\n");

    // Fix any remaining unclosed code blocks at the end
    const codeBlockRegex = /```[\s\S]*$/;
    if (codeBlockRegex.test(processed) && !processed.trim().endsWith("```")) {
      processed += "\n```";
    }

    return processed;
  }

  constructor(options: FormatOptions = {}) {
    this.options = {
      enableSyntaxHighlight: options.enableSyntaxHighlight ?? true,
      enableJsonFormatting: options.enableJsonFormatting ?? true,
      enableMarkdown: options.enableMarkdown ?? true,
    };
  }

  /**
   * Format LLM output text to HTML with markdown and code block support
   */
  format(text: string): string {
    console.log("LLM Response Processor - Raw input:", text);

    // Parse Harmony protocol if present (for models that use it)
    const parsed = HarmonyParser.parse(text);
    const processedText = parsed.content;

    const { enableSyntaxHighlight, enableJsonFormatting, enableMarkdown } =
      this.options;

    // Preprocess the text to fix common LLM markdown issues
    let html = this.preprocessLLMOutput(processedText);

    if (enableMarkdown) {
      // Extract thinking blocks and replace with placeholders
      const thinkingBlocks: string[] = [];
      html = html.replace(
        /<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/g,
        (match, content) => {
          const placeholder = `___THINKING_BLOCK_${thinkingBlocks.length}___`;
          thinkingBlocks.push(content);
          return placeholder;
        }
      );

      // Extract code blocks and replace with placeholders
      const codeBlocks: string[] = [];
      html = html.replace(/```[\s\S]*?```/g, (match) => {
        console.log("Extracted code block:", match.substring(0, 100) + "...");
        const placeholder = `___CODE_BLOCK_${codeBlocks.length}___`;
        codeBlocks.push(match);
        return placeholder;
      });

      // Escape HTML in remaining text (outside code blocks and thinking blocks)
      html = this.escapeHtml(html);

      // Process thinking blocks first
      for (let i = 0; i < thinkingBlocks.length; i++) {
        const placeholder = `___THINKING_BLOCK_${i}___`;
        const processedBlock = this.processThinkingBlock(thinkingBlocks[i]);
        html = html.replace(placeholder, processedBlock);
      }

      // Process code blocks (triple backticks) - process placeholders
      for (let i = 0; i < codeBlocks.length; i++) {
        const placeholder = `___CODE_BLOCK_${i}___`;
        console.log(
          "Processing code block",
          i,
          ":",
          codeBlocks[i].substring(0, 100)
        );
        const processedBlock = this.processCodeBlock(
          codeBlocks[i],
          enableSyntaxHighlight,
          enableJsonFormatting
        );
        console.log("Processed block:", processedBlock.substring(0, 100));
        html = html.replace(placeholder, processedBlock);
      }

      // Process inline code (single backticks)
      html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

      // Process bold (**text** or __text__)
      html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
      html = html.replace(/__(.+?)__/g, "<strong>$1</strong>");

      // Process italic (*text* or _text_)
      html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
      html = html.replace(/_(.+?)_/g, "<em>$1</em>");

      // Process headings
      html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
      html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
      html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");

      // Process lists
      html = this.processLists(html);

      // Process links [text](url)
      html = html.replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        '<a href="$2" target="_blank">$1</a>'
      );

      // Process line breaks (double newline = paragraph)
      html = html.replace(/\n\n/g, "</p><p>");
      html = "<p>" + html + "</p>";

      // Clean up empty paragraphs
      html = html.replace(/<p><\/p>/g, "");
    }

    console.log("LLM Response Processor - Processed output:", html);
    return html;
  }

  /**
   * Preprocess LLM output to fix common markdown formatting issues.
   * Exposed as static for server-side use before sending to webview.
   */
  static preprocess(text: string): string {
    return LLMResponseProcessor.preprocessLLMOutput(text);
  }

  /**
   * Preprocess LLM output to fix common markdown formatting issues
   */
  private preprocessLLMOutput(text: string): string {
    return LLMResponseProcessor.preprocessLLMOutput(text);
  }

  /**
   * Process a thinking block with collapsible functionality
   */
  private processThinkingBlock(content: string): string {
    // Format the content inside the thinking block with markdown
    const formattedContent = this.formatThinkingContent(content.trim());

    return `<div class="thinking-block-container">
    <div class="thinking-header" onclick="this.parentElement.classList.toggle('expanded')">
      <span class="thinking-icon">💭</span>
      <span class="thinking-label">Reasoning</span>
      <span class="thinking-toggle">▼</span>
    </div>
    <div class="thinking-content">${formattedContent}</div>
  </div>`;
  }

  /**
   * Format markdown content inside thinking blocks
   */
  private formatThinkingContent(text: string): string {
    let html = this.escapeHtml(text);

    // Process inline code (single backticks)
    html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

    // Process bold (**text** or __text__)
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/__(.+?)__/g, "<strong>$1</strong>");

    // Process italic (*text* or _text_)
    html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
    html = html.replace(/_(.+?)_/g, "<em>$1</em>");

    // Process line breaks
    html = html.replace(/\n/g, "<br>");

    return html;
  }

  /**
   * Process a single code block with language-specific formatting
   */
  private processCodeBlock(
    codeBlockText: string,
    enableSyntaxHighlight: boolean,
    enableJsonFormatting: boolean
  ): string {
    // Extract language and code from ```lang\ncode\n```
    const match = codeBlockText.match(/```(\w*)\n([\s\S]*?)```/);
    if (!match) {
      console.log(
        "processCodeBlock: no match for:",
        codeBlockText.substring(0, 100)
      );
      return codeBlockText;
    }

    const language = match[1] || "";
    const code = match[2] || "";
    const lang = language.trim().toLowerCase();
    const trimmedCode = code.trim();

    // Detect if it's JSON and format it
    if (enableJsonFormatting && (lang === "json" || this.isJSON(trimmedCode))) {
      try {
        const formatted = JSON.stringify(JSON.parse(trimmedCode), null, 2);
        const escapedCode = this.escapeHtml(formatted);
        return `<pre class="code-block" data-language="json"><code class="language-json">${escapedCode}</code></pre>`;
      } catch (e) {
        // If JSON parsing fails, treat as regular code
      }
    }

    // Escape HTML in code content
    const escapedCode = this.escapeHtml(trimmedCode);

    const languageClass = lang ? `language-${lang}` : "language-text";
    const languageLabel = lang
      ? `<div class="code-block-header"><span class="language-label">${lang}</span><button class="copy-button" data-code="${this.escapeForAttribute(trimmedCode)}">Copy</button></div>`
      : "";

    return `<div class="code-block-container">${languageLabel}<pre class="code-block" data-language="${lang}"><code class="${languageClass}">${escapedCode}</code></pre></div>`;
  }

  /**
   * Process markdown lists (ordered and unordered)
   */
  private processLists(text: string): string {
    const lines = text.split("\n");
    let out = "";
    let currentListType: "ul" | "ol" | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const ulMatch = line.match(/^(\s*)[*\-+]\s+(.+)$/);
      const olMatch = line.match(/^(\s*)\d+\.\s+(.+)$/);

      if (ulMatch || olMatch) {
        const isOl = !!olMatch;
        const match = ulMatch || (olMatch as RegExpMatchArray);
        const indent = match[1] || "";
        const content = match[2] || "";
        const listTag = isOl ? "ol" : "ul";

        if (currentListType !== listTag) {
          if (currentListType) {
            out += `</${currentListType}>\n`;
          }
          out += `<${listTag}>\n`;
          currentListType = listTag;
        }

        const level = Math.floor(indent.length / 2);
        out += `<li class="list-item${isOl ? " ordered" : ""}" data-level="${level}">${content}</li>\n`;
      } else {
        if (currentListType) {
          out += `</${currentListType}>\n`;
          currentListType = null;
        }
        out += line + "\n";
      }
    }

    if (currentListType) {
      out += `</${currentListType}>\n`;
    }

    return out.trim();
  }

  /**
   * Check if a string is valid JSON
   */
  private isJSON(str: string): boolean {
    try {
      JSON.parse(str);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Escape HTML to prevent XSS
   */
  private escapeHtml(text: string): string {
    const htmlEntities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return text.replace(/[&<>"']/g, (char) => htmlEntities[char]);
  }

  /**
   * Escape text for use in HTML attributes
   */
  private escapeForAttribute(text: string): string {
    return text.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
}

/**
 * Legacy function for backward compatibility
 * @deprecated Use LLMResponseProcessor class instead
 */
export function formatLLMOutput(
  text: string,
  options: FormatOptions = {}
): string {
  const processor = new LLMResponseProcessor(options);
  return processor.format(text);
}
