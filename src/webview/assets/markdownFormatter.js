/**
 * Markdown formatting utilities for the webview
 */

/**
 * Parse Harmony protocol messages and extract the final message
 */
function parseHarmonyMessage(input) {
  // Check if input contains Harmony protocol tags
  if (!input.includes("<|start|>") || !input.includes("<|end|>")) {
    // Not a Harmony message, return as-is
    return {
      finalMessage: input,
      channels: [],
      metadata: {},
    };
  }

  const channels = [];
  const metadata = {};
  let finalMessage = "";

  // Simple parser using regex to extract sections
  const tagRegex = /<\|(\w+)\|>(.*?)(?=<\|[\w]+\|>|$)/gs;
  let match;
  let currentChannel = "";
  let inFinal = false;

  while ((match = tagRegex.exec(input)) !== null) {
    const tag = match[1];
    const content = match[2].trim();

    switch (tag) {
      case "start":
        // Reset for new message
        currentChannel = "";
        inFinal = false;
        break;
      case "channel":
        currentChannel = content;
        if (!channels.includes(content)) {
          channels.push(content);
        }
        break;
      case "message":
        if (inFinal || currentChannel === "final") {
          finalMessage += content + " ";
        }
        break;
      case "final":
        inFinal = true;
        finalMessage += content + " ";
        break;
      case "assistant":
        // Ignore assistant tag for metadata
        break;
      case "end":
        // End of current message
        break;
      default:
        // Unknown tag, add to metadata
        metadata[tag] = content;
    }
  }

  // Clean up final message
  finalMessage = finalMessage.trim();

  // If no final message found, use the entire input as fallback
  if (!finalMessage) {
    finalMessage = input;
  }

  return {
    finalMessage,
    channels,
    metadata,
  };
}

/**
 * Preprocess markdown text to fix common LLM formatting issues
 */
function preprocessMarkdown(text) {
  let processed = text;

  // Add line breaks before common section headers to help parsing
  processed = processed.replace(/(Features:|Usage:|Output:|Would you like)/g, "\n$1");

  // Fix cases where language is on its own line followed by code
  const lines = processed.split("\n");
  let result = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    const nextLine = lines[i + 1] || "";

    // Check if this line is just a language name and next line starts with code
    if (
      line &&
      !line.includes(" ") &&
      !line.startsWith("#") &&
      !line.startsWith("-") &&
      !line.startsWith("*") &&
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
      let codeLines = [];
      let j = i + 1;

      // Collect code lines until we hit a clear non-code indicator
      // (section headers, list items - avoid breaking on Python # comments)
      while (j < lines.length) {
        const codeLine = lines[j];
        if (
          codeLine.match(/^[A-Z][^:]*:/) ||
          codeLine.startsWith("- ") ||
          codeLine.match(/^\d+\. /) ||
          codeLine.startsWith("With ") ||
          codeLine.startsWith("Would ") ||
          codeLine.startsWith("# Output")
        ) {
          break;
        }
        codeLines.push(codeLine);
        j++;
      }

      if (codeLines.length > 0) {
        result.push("```" + line);
        result.push(...codeLines);
        result.push("```");
        i = j - 1; // Skip the code lines we just processed
      } else {
        result.push(lines[i]);
      }
    } else {
      result.push(lines[i]);
    }
    i++;
  }

  processed = result.join("\n");

  // Fix malformed patterns: python# hello.py -> ```python\n# hello.py
  processed = processed.replace(
    /(\w+)#\s*([^]*?)(This creates:|Usage:|Output:|Save this as|Would you like)/g,
    (match, lang, code, endMarker) =>
      "```" + lang.trim() + "\n# " + code.trim() + "\n```\n\n" + endMarker
  );
  processed = processed.replace(/(\w+)#(\s*)(.+)$/gm, "```$1\n# $3");

  // Fix: python def greet... -> ```python\ndef greet...
  processed = processed.replace(
    /^(\w+)(def |class |import |from |function |\w+\s*= |\w+\s*\()/gm,
    "```$1\n$2"
  );

  // Fix: bashpython hello.py -> ```bash\npython hello.py
  processed = processed.replace(/^bash(\w.+)$/gm, "```bash\n$1");

  return processed;
}

/**
 * Format markdown text to HTML
 */
function formatMarkdown(text) {
  console.log("Raw input:", text);

  // First, parse Harmony protocol if present
  const parsed = parseHarmonyMessage(text);
  let html = parsed.finalMessage;

  // Preprocess to fix common formatting issues
  html = preprocessMarkdown(html);

  // Extract thinking blocks BEFORE escaping HTML (use placeholders)
  const thinkingBlocks = [];
  html = html.replace(
    /<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/g,
    (match, content) => {
      const placeholder =
        "PLACEHOLDERTHINKINGBLOCK" + thinkingBlocks.length + "PLACEHOLDER";
      thinkingBlocks.push(content);
      return placeholder;
    }
  );

  // Extract code blocks BEFORE escaping HTML (use placeholders)
  // Supports: ```lang\ncode```, ```lang\n\ncode```, ```\ncode```
  const codeBlocks = [];
  html = html.replace(/```(\w*)\s*\n([\s\S]*?)```/g, (match, language, code) => {
    const placeholder =
      "PLACEHOLDERCODEBLOCK" + codeBlocks.length + "PLACEHOLDER";
    codeBlocks.push({ language: language.trim(), code: code.trim() });
    return placeholder;
  });

  // Log extracted code blocks for debugging
  if (codeBlocks.length > 0) {
    console.log("Found", codeBlocks.length, "code block(s):");
    codeBlocks.forEach((block, i) => {
      console.log(`Code block ${i + 1} (${block.language}):`, block.code);
    });
  }

  // Escape HTML
  html = escapeHtml(html);

  // Process inline code (single backticks)
  html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

  // Process bold (**text** or __text__)
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__(.+?)__/g, "<strong>$1</strong>");

  // Process italic (*text* or _text_)
  // Updated regex for processing italic text to avoid trimming underscores
  html = html.replace(/(?<!\w)\*([^\*]+?)\*(?!\w)/g, "<em>$1</em>");
  html = html.replace(/(?<!\w)_([^_]+?)_(?!\w)/g, "<em>$1</em>");

  // Process headings
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");

  // Process lists (ordered and unordered) - proper handling of multiple lists
  html = processLists(html);

  // Process links [text](url)
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank">$1</a>'
  );

  // Process line breaks (double newline = paragraph)
  const lines = html.split("\n");
  let inBlock = false;
  let result = [];
  let paragraph = [];

  for (let line of lines) {
    if (
      line.includes('<pre class="code-block"') ||
      line.includes('<div class="code-block-container"')
    ) {
      if (paragraph.length > 0) {
        result.push("<p>" + paragraph.join("<br>") + "</p>");
        paragraph = [];
      }
      result.push(line);
      inBlock = true;
    } else if (line.includes("</pre>") || line.includes("</div>")) {
      result.push(line);
      inBlock = false;
    } else if (inBlock) {
      result.push(line);
    } else if (line.trim() === "") {
      if (paragraph.length > 0) {
        result.push("<p>" + paragraph.join("<br>") + "</p>");
        paragraph = [];
      }
    } else if (
      line.match(/^<h[123]>/) ||
      line.match(/^<[uo]l>/) ||
      line.match(/^<\/[uo]l>/) ||
      line.match(/^<li\s/)
    ) {
      if (paragraph.length > 0) {
        result.push("<p>" + paragraph.join("<br>") + "</p>");
        paragraph = [];
      }
      result.push(line);
    } else {
      paragraph.push(line);
    }
  }

  if (paragraph.length > 0) {
    result.push("<p>" + paragraph.join("<br>") + "</p>");
  }

  html = result.join("\n");

  // Process code block placeholders
  for (let i = 0; i < codeBlocks.length; i++) {
    const placeholder = "PLACEHOLDERCODEBLOCK" + i + "PLACEHOLDER";
    let { language, code } = codeBlocks[i];
    const lang = language.toLowerCase();

    // Format and detect JSON
    if (lang === "json" || isJSON(code)) {
      try {
        const formatted = JSON.stringify(JSON.parse(code), null, 2);
        code = formatted;
      } catch (e) {
        // Keep original if JSON parse fails
      }
    }

    const languageClass = lang ? "language-" + lang : "language-text";
    const languageLabel = lang
      ? '<div class="code-block-header"><span class="language-label">' +
        lang +
        '</span><button class="copy-button" data-code="' +
        escapeAttribute(code) +
        '">Copy</button></div>'
      : '<div class="code-block-header"><button class="copy-button" data-code="' +
        escapeAttribute(code) +
        '">Copy</button></div>';

    // Escape code content to prevent XSS (e.g. <script> in LLM output)
    const escapedCode = escapeHtml(code);
    const codeBlockHtml =
      '<div class="code-block-container">' +
      languageLabel +
      '<pre class="code-block" data-language="' +
      lang +
      '"><code class="' +
      languageClass +
      '">' +
      escapedCode +
      "</code></pre></div>";
    html = html.replace(placeholder, codeBlockHtml);
  }

  // Process thinking block placeholders at the end
  for (let i = 0; i < thinkingBlocks.length; i++) {
    const placeholder = "PLACEHOLDERTHINKINGBLOCK" + i + "PLACEHOLDER";
    const content = thinkingBlocks[i].trim();
    const formattedContent = formatThinkingContent(content);
    const thinkingHtml =
      '<div class="thinking-block-container">' +
      '<div class="thinking-header" aria-expanded="false">' +
      '<span class="thinking-icon">💭</span>' +
      '<span class="thinking-label">Reasoning</span>' +
      '<span class="thinking-toggle">▼</span>' +
      "</div>" +
      '<div class="thinking-content">' +
      formattedContent +
      "</div>" +
      "</div>";
    html = html.replace(placeholder, thinkingHtml);
  }

  // Convert HTML to readable text for logging
  const readableOutput = html
    .replace(/<p>/g, "")
    .replace(/<\/p>/g, "\n\n")
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  console.log(
    "Processed output (readable):",
    readableOutput.substring(0, 200) + "..."
  );
  return html;
}

/**
 * Process markdown lists (ordered and unordered)
 */
function processLists(text) {
  const lines = text.split("\n");
  let out = "";
  let currentListType = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ulMatch = line.match(/^(\s*)[*\-+]\s+(.+)$/);
    const olMatch = line.match(/^(\s*)\d+\.\s+(.+)$/);

    if (ulMatch || olMatch) {
      const isOl = !!olMatch;
      const match = ulMatch || olMatch;
      const indent = match[1] || "";
      const content = match[2] || "";
      const listTag = isOl ? "ol" : "ul";

      if (currentListType !== listTag) {
        if (currentListType) {
          out += "</" + currentListType + ">\n";
        }
        out += "<" + listTag + ">\n";
        currentListType = listTag;
      }

      const level = Math.floor(indent.length / 2);
      out +=
        '<li class="list-item' +
        (isOl ? " ordered" : "") +
        '" data-level="' +
        level +
        '">' +
        content +
        "</li>\n";
    } else {
      if (currentListType) {
        out += "</" + currentListType + ">\n";
        currentListType = null;
      }
      out += line + "\n";
    }
  }

  if (currentListType) {
    out += "</" + currentListType + ">\n";
  }

  return out.trim();
}

/**
 * Format content inside thinking blocks
 */
function formatThinkingContent(text) {
  let html = escapeHtml(text);

  // Process inline code
  html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

  // Process bold
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__(.+?)__/g, "<strong>$1</strong>");

  // Process italic
  html = html.replace(/(?<!\w)\*([^\*]+?)\*(?!\w)/g, "<em>$1</em>");
  html = html.replace(/(?<!\w)_([^_]+?)_(?!\w)/g, "<em>$1</em>");

  // Process line breaks
  html = html.replace(/\n/g, "<br>");

  return html;
}

/**
 * Process code blocks with language-specific formatting
 */
function processCodeBlocks(text) {
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;

  return text.replace(codeBlockRegex, (match, language, code) => {
    const lang = language.trim().toLowerCase();
    const trimmedCode = code.trim();

    // Check if it's JSON and format it
    if (lang === "json" || isJSON(trimmedCode)) {
      try {
        const parsed = JSON.parse(trimmedCode);
        const formatted = JSON.stringify(parsed, null, 2);
        const languageLabel =
          '<div class="code-block-header"><span class="language-label">json</span><button class="copy-button" data-code="' +
          escapeAttribute(formatted) +
          '">Copy</button></div>';
        return (
          '<div class="code-block-container">' +
          languageLabel +
          '<pre class="code-block" data-language="json"><code class="language-json">' +
          formatted +
          "</code></pre></div>"
        );
      } catch (e) {
        // If JSON parsing fails, treat as regular code
      }
    }

    const languageClass = lang ? "language-" + lang : "language-text";
    const languageLabel = lang
      ? '<div class="code-block-header"><span class="language-label">' +
        lang +
        '</span><button class="copy-button" data-code="' +
        escapeAttribute(trimmedCode) +
        '">Copy</button></div>'
      : '<div class="code-block-header"><button class="copy-button" data-code="' +
        escapeAttribute(trimmedCode) +
        '">Copy</button></div>';

    return (
      '<div class="code-block-container">' +
      languageLabel +
      '<pre class="code-block" data-language="' +
      lang +
      '"><code class="' +
      languageClass +
      '">' +
      trimmedCode +
      "</code></pre></div>"
    );
  });
}

/**
 * Utility functions
 */
function isJSON(str) {
  try {
    JSON.parse(str);
    return true;
  } catch (e) {
    return false;
  }
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttribute(text) {
  return text.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Export functions for testing
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    formatMarkdown,
    parseHarmonyMessage,
    formatThinkingContent,
    processLists,
    preprocessMarkdown,
    isJSON,
    escapeHtml,
    escapeAttribute,
  };
}
