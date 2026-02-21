import { XmlProcessor } from "../src/utils/xmlProcessor";

/**
 * Tests for XmlProcessor handling of AWK code with complex content.
 *
 * The problematic tool call from the user has this structure:
 *   <tool_call name="create_file" args='{ "file_path": "filter.awk", "content": "...we\'ve..." }' />
 *
 * Key challenges:
 * 1. The args attribute uses single quotes: args='...'
 * 2. The AWK code content contains \' (escaped single quote) in "we\'ve"
 * 3. The content is very long (~3000+ chars) with many \n and \" sequences
 * 4. The content has regex patterns like /=== PAGE [0-9]+ ===/
 */
describe("XmlProcessor - AWK code with escaped single quote in content", () => {
  it("should handle \\' (escaped single quote) inside single-quoted args attribute", () => {
    // Simplified version isolating the core issue:
    // args='...' where the JSON content has \' (backslash + single quote)
    // This is what LLMs output when they try to escape a ' inside a '-delimited attribute.
    //
    // Raw XML: <tool_call name="create_file" args='{ "file_path": "t.awk", "content": "# we\'ve got data" }' />
    // In TS template literal: \\' produces literal \'
    const rawToolCall = `<tool_call name="create_file" args='{ "file_path": "t.awk", "content": "# we\\'ve got data" }' />`;

    const result = XmlProcessor.extractToolCalls(rawToolCall);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("create_file");
    expect(result[0].args.file_path).toBe("t.awk");
    expect(result[0].args.content).toBeDefined();
    expect(result[0].args.content).toContain("we've got data");
  });

  it("should handle multiple \\' occurrences inside single-quoted args", () => {
    // Content with several escaped single quotes
    const rawToolCall = `<tool_call name="create_file" args='{ "file_path": "t.awk", "content": "# it\\'s here and we\\'ve got it, don\\'t worry" }' />`;

    const result = XmlProcessor.extractToolCalls(rawToolCall);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("create_file");
    expect(result[0].args.file_path).toBe("t.awk");
    expect(result[0].args.content).toBeDefined();
    expect(result[0].args.content).toContain("it's here");
    expect(result[0].args.content).toContain("we've got it");
    expect(result[0].args.content).toContain("don't worry");
  });

  it("should extract the full AWK filter.awk tool call from user's exact input", () => {
    // This reproduces the EXACT tool call the user reported as failing.
    //
    // The LLM produces a raw tool call like:
    //   <tool_call name="create_file" args='{ "file_path": "...", "content": "...code..." }' />
    //
    // Inside the JSON content string, the LLM uses:
    //   \n  → literal backslash + n   (JSON newline escape)
    //   \"  → literal backslash + "   (JSON double-quote escape)
    //   \'  → literal backslash + '   (LLM escapes ' because args uses single quotes)
    //
    // We build the raw string programmatically to avoid template literal escaping confusion.

    const awkCode = `# filter.awk - Filter block data from input file
# Usage: awk -f filter.awk [-v page=N] input_file

BEGIN {
    # Default page number
    if (page == "") page = 0
    
    # State variables
    in_block = 0
    block_length = 0
    current_page = -1
    data_count = 0
    
    # Arrays to store block data
    delete data
}

# Parse page number: === PAGE 000 ===
/=== PAGE [0-9][0-9][0-9] ===/ {
    match($0, /PAGE ([0-9]+)/, arr)
    current_page = int(arr[1])
    next
}

# Parse header: MC=0
/MC=0/ {
    # Extract block length from byte 2 and 3 (next two hex values after index)
    match($0, /MC=0[ ]+([0-9A-Fa-f]+) ([0-9A-Fa-f]+) ([0-9A-Fa-f]+)/, arr)
    if (arr[2] != "" && arr[3] != "") {
        block_length = hex2dec(arr[2]) * 256 + hex2dec(arr[3])
    }
    in_block = 1
    data_count = 0
    next
}

# Parse body: MC=1 to MC=F9 (and wrap around)
/MC=[0-9A-Fa-f]+/ {
    if (!in_block) next
    
    # Extract message index
    match($0, /MC=([0-9A-Fa-f]+)/, arr)
    if (arr[1] == "") next
    
    idx = hex2dec(arr[1])
    
    # Skip header (0) and footer (FA)
    if (idx == 0 || idx == 250) next
    
    # Handle wrap-around: if idx > 249, start from 1 again
    if (idx > 249) {
        idx = ((idx - 1) % 249) + 1
    }
    
    # Extract data bytes (7 bytes after index)
    # Format: index byte1 byte2 byte3 byte4 byte5 byte6 byte7
    match($0, /[0-9A-Fa-f]+[ ]+([0-9A-Fa-f]+) ([0-9A-Fa-f]+) ([0-9A-Fa-f]+) ([0-9A-Fa-f]+) ([0-9A-Fa-f]+) ([0-9A-Fa-f]+) ([0-9A-Fa-f]+)/, data_arr)
    
    # Store data (skip first byte which is index)
    for (i = 1; i <= 7; i++) {
        if (data_arr[i] != "") {
            data[data_count++] = data_arr[i]
        }
    }
    
    # Check if we've collected enough data
    if (data_count >= block_length) {
        in_block = 0
        
        # Output the collected data (convert to output format)
        # Each line has up to 7 bytes (14 hex chars + spaces)
        for (i = 0; i < data_count; i += 7) {
            # Determine how many bytes to output on this line
            bytes_in_line = (data_count - i < 7) ? (data_count - i) : 7
            
            # Build output line
            line = ""
            for (j = 0; j < bytes_in_line; j++) {
                if (j > 0) line = line " "
                line = line toupper(data[i + j])
            }
            print line
        }
        
        # Reset for next block
        delete data
        data_count = 0
        block_length = 0
    }
    next
}

# Parse footer: MC=FA
/MC=FA/ {
    # In some cases, footer might indicate end of block even if data not fully collected
    # But according to spec, we should have already output data when data_count >= block_length
    # This handler is here for completeness
    in_block = 0
    next
}

# Helper function to convert hex string to decimal
function hex2dec(hex,    result, i, c, val) {
    result = 0
    hex = tolower(hex)
    for (i = 1; i <= length(hex); i++) {
        c = substr(hex, i, 1)
        if (c >= "0" && c <= "9") val = c + 0
        else if (c == "a") val = 10
        else if (c == "b") val = 11
        else if (c == "c") val = 12
        else if (c == "d") val = 13
        else if (c == "e") val = 14
        else if (c == "f") val = 15
        else val = 0
        result = result * 16 + val
    }
    return result
}
`;

    // Build the raw tool call as the LLM would produce it:
    // 1. Encode the AWK code as JSON content (escape " and newlines)
    // 2. Replace ' with \' (LLM escapes single quotes since args uses single-quote delimiters)
    // 3. Wrap in <tool_call> XML

    // Step 1: JSON.stringify gives us properly escaped JSON
    const jsonArgs = JSON.stringify({
      file_path: "c:/code/github/crc16/filter.awk",
      content: awkCode,
    });

    // Step 2: Simulate LLM behavior - escape the ' in "we've" with \'
    // The LLM sees that args uses single quotes, so it escapes ' in the content.
    // In the JSON string, the ' in "we've" is unescaped (valid JSON).
    // The LLM adds a backslash before it: we've → we\'ve
    // In the raw JSON string, this means: we\\'ve → we\\'ve 
    // (the ' doesn't need JSON escaping, but the LLM adds \' for XML safety)
    const llmJsonArgs = jsonArgs.replace("we've", "we\\'ve");

    // Step 3: Build the tool call XML
    const rawToolCall = `<tool_call name="create_file" args='${llmJsonArgs}' />`;

    console.log(`\nRaw tool call length: ${rawToolCall.length} chars`);
    console.log(`Contains \\': ${rawToolCall.includes("\\'")}`);
    // Show the area around the escaped quote
    const escIdx = rawToolCall.indexOf("\\'");
    if (escIdx >= 0) {
      console.log(`\\' at position ${escIdx}: ...${rawToolCall.substring(escIdx - 20, escIdx + 20)}...`);
    }

    const result = XmlProcessor.extractToolCalls(rawToolCall);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("create_file");
    expect(result[0].args.file_path).toBe("c:/code/github/crc16/filter.awk");

    const content = result[0].args.content;
    expect(content).toBeDefined();

    // Verify key parts of the AWK code are present
    expect(content).toContain("# filter.awk - Filter block data from input file");
    expect(content).toContain("BEGIN {");
    expect(content).toContain("we've collected enough data");
    expect(content).toContain("function hex2dec(hex,");
    expect(content).toContain("return result");
  });

  it("should extract AWK code using JSON.stringify (ideal format without \\')", () => {
    // This test uses JSON.stringify to produce properly escaped JSON,
    // which does NOT have the \\' issue (single quotes don't need escaping in JSON).
    const awkCode = `# filter.awk
BEGIN {
    if (page == "") page = 0
    in_block = 0
}

/=== PAGE [0-9][0-9][0-9] ===/ {
    match($0, /PAGE ([0-9]+)/, arr)
    current_page = int(arr[1])
    next
}

# Check if we've collected enough data
if (data_count >= block_length) {
    in_block = 0
}

function hex2dec(hex,    result, i, c, val) {
    result = 0
    hex = tolower(hex)
    for (i = 1; i <= length(hex); i++) {
        c = substr(hex, i, 1)
        if (c >= "0" && c <= "9") val = c + 0
        else if (c == "a") val = 10
        else val = 0
        result = result * 16 + val
    }
    return result
}`;

    const jsonArgs = JSON.stringify({
      file_path: "c:/code/github/crc16/filter.awk",
      content: awkCode,
    });
    const toolCallXml = `<tool_call name="create_file" args='${jsonArgs}' />`;

    const result = XmlProcessor.extractToolCalls(toolCallXml);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("create_file");
    expect(result[0].args.file_path).toBe("c:/code/github/crc16/filter.awk");
    expect(result[0].args.content).toBe(awkCode);

    // Verify the apostrophe in "we've" survived
    expect(result[0].args.content).toContain("we've collected enough data");
    // Verify awk patterns
    expect(result[0].args.content).toContain("/=== PAGE [0-9][0-9][0-9] ===/");
    expect(result[0].args.content).toContain('if (c >= "0" && c <= "9")');
    expect(result[0].args.content).toContain("function hex2dec(hex,");
  });

  it("should handle AWK code with \\' near the end of a long content string", () => {
    // The \\' might be more problematic near the end where the parser
    // is looking for the closing quote of the args attribute.
    // This positions the \\' close to the closing }' />
    const rawToolCall = `<tool_call name="create_file" args='{ "file_path": "test.awk", "content": "BEGIN {\\n    delete data\\n}\\n\\nfunction process() {\\n    # we\\'ve done\\n}\\n" }' />`;

    const result = XmlProcessor.extractToolCalls(rawToolCall);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("create_file");
    expect(result[0].args.file_path).toBe("test.awk");
    expect(result[0].args.content).toBeDefined();
    expect(result[0].args.content).toContain("we've done");
    expect(result[0].args.content).toContain("function process()");
  });

  it("should handle AWK code with regex patterns containing special chars", () => {
    // AWK regex patterns like /MC=[0-9A-Fa-f]+/ might confuse parsers
    // because of the / characters and brackets
    const rawToolCall = `<tool_call name="create_file" args='{ "file_path": "test.awk", "content": "/MC=[0-9A-Fa-f]+/ {\\n    match($0, /MC=([0-9A-Fa-f]+)/, arr)\\n    next\\n}" }' />`;

    const result = XmlProcessor.extractToolCalls(rawToolCall);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("create_file");
    expect(result[0].args.content).toContain("/MC=[0-9A-Fa-f]+/");
    expect(result[0].args.content).toContain("match($0,");
  });

  it("should handle AWK code with $0 and $1 variables", () => {
    const rawToolCall = `<tool_call name="create_file" args='{ "file_path": "test.awk", "content": "{ print $0; x = $1 + $2 }" }' />`;

    const result = XmlProcessor.extractToolCalls(rawToolCall);

    expect(result).toHaveLength(1);
    expect(result[0].args.content).toContain("$0");
    expect(result[0].args.content).toContain("$1");
    expect(result[0].args.content).toContain("$2");
  });

  it("should handle AWK code with ternary operator (?:)", () => {
    const rawToolCall = `<tool_call name="create_file" args='{ "file_path": "test.awk", "content": "bytes = (count < 7) ? count : 7" }' />`;

    const result = XmlProcessor.extractToolCalls(rawToolCall);

    expect(result).toHaveLength(1);
    expect(result[0].args.content).toContain("(count < 7) ? count : 7");
  });

  it("should handle \\' followed by closing }' pattern (ambiguous ending)", () => {
    // This tests the specific pattern at the end of the user's tool call
    // where the content ends with }\n and the JSON/attribute close is }' />
    // After \', the parser needs to correctly identify the REAL closing '
    const rawToolCall = `<tool_call name="create_file" args='{ "file_path": "test.awk", "content": "# we\\'ve done\\nresult = 0\\n" }' />`;

    const result = XmlProcessor.extractToolCalls(rawToolCall);

    expect(result).toHaveLength(1);
    expect(result[0].args.file_path).toBe("test.awk");
    expect(result[0].args.content).toBeDefined();
    expect(result[0].args.content).toContain("we've done");
    expect(result[0].args.content).toContain("result = 0");
  });
});
