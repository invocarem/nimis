import { extractHarmonyToolCall } from "../src/utils/HarmonyToolCallExtractor";
import type { MCPToolCall } from "../src/utils/toolCallExtractor";

describe("HarmonyToolCallExtractor", () => {
  it("extracts tool call from Harmony format (OpenAI Harmony)", () => {
    const response =
      '<|start|>assistant<|channel|>analysis to=tool_call code<|message|>{\n  "name": "analyze_latin",\n  "arguments": {\n    "word": "invenietur"\n  }\n}\n\n';
    const result = extractHarmonyToolCall(response);
    expect(result).toEqual({
      name: "analyze_latin",
      arguments: { word: "invenietur" },
    });
  });

  it("returns null if no Harmony tool_call marker", () => {
    const response = "<|start|>assistant<|channel|>analysis<|message|>Hello</|end|>";
    expect(extractHarmonyToolCall(response)).toBeNull();
  });

  it("extracts tool call with empty arguments", () => {
    const response =
      'to=tool_call code<|message|>{"name": "ping", "arguments": {}}\n';
    const result = extractHarmonyToolCall(response);
    expect(result).toEqual({ name: "ping", arguments: {} });
  });

  it("returns null when name is missing in JSON", () => {
    const response = 'to=tool_call code<|message|>{"arguments": {"x": 1}}\n';
    expect(extractHarmonyToolCall(response)).toBeNull();
  });

  it("extracts OpenAI Harmony spec format: to=vim <|constrain|>json<|message|>{...}", () => {
    const response = `<|start|>assistant<|channel|>commentary to=vim <|constrain|>json<|message|>{
  "file_path": "crc16.awk",
  "commands": [
    ":e crc16.awk",
    ":%print"
  ]
}`;
    const result = extractHarmonyToolCall(response);
    expect(result).toEqual({
      name: "vim",
      arguments: {
        file_path: "crc16.awk",
        commands: [":e crc16.awk", ":%print"],
      },
    });
  });

  it("extracts functions.vim from <|constrain|>json (strips functions. prefix)", () => {
    const response = `<|channel|>commentary to=functions.vim <|constrain|>json<|message|>{"file_path":"x.ts","commands":["w"]}`;
    const result = extractHarmonyToolCall(response);
    expect(result).toEqual({
      name: "vim",
      arguments: { file_path: "x.ts", commands: ["w"] },
    });
  });

  it("extracts Harmony variant format: commentary to=vim json{...}", () => {
    const response = `commentary to=vim json{
"file_path": "calc.py",
"commands": ":%print"
}`;
    const result = extractHarmonyToolCall(response);
    expect(result).toEqual({
      name: "vim",
      arguments: { file_path: "calc.py", commands: ":%print" },
    });
  });

  it("extracts to=<tool> json format without commentary prefix", () => {
    const response = 'to=vim json{"file_path": "x.ts", "commands": ":w"}';
    const result = extractHarmonyToolCall(response);
    expect(result).toEqual({
      name: "vim",
      arguments: { file_path: "x.ts", commands: ":w" },
    });
  });

  it("extracts to=<tool> code<|message|>{...} hybrid format", () => {
    const response =
      '<|start|>assistant<|channel|>analysis to=vim code<|message|>{\n  "file_path": "",\n  "commands": [\n    ":!grep -R \\"crc16_table\\" -n ."\n  ]\n}';
    const result = extractHarmonyToolCall(response);
    expect(result).toEqual({
      name: "vim",
      arguments: {
        file_path: "",
        commands: [':!grep -R "crc16_table" -n .'],
      },
    });
  });

  /**
   * Isolation: "analysis to=vim" token parsing with SIMPLE JSON (no \\x1b, no triple quotes).
   * If this passes → token parsing is fine; failure is in JSON content.
   */
  it("parses analysis to=vim code format with simple JSON only", () => {
    const response = `<|start|>assistant<|channel|>analysis to=vim code<|message|>{
  "file_path": "calc.py",
  "commands": [":e calc.py", ":3", ":w", ":%print #"]
}`;
    const result = extractHarmonyToolCall(response);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("vim");
    expect(result!.arguments.file_path).toBe("calc.py");
  });

  /**
   * Isolation: LLM often outputs "\\x1b" (single backslash) — invalid JSON; \\x not in JSON spec.
   * Valid JSON would be "\\\\x1b" (double backslash) → literal string \\x1b.
   * This test uses the INVALID format; if it fails → \\x1b is the cause of the regression.
   */
  it("parses analysis to=vim when JSON has invalid \\x1b escape (single backslash)", () => {
    // Raw: "\\x1b" in template → \x1b in output → JSON.parse fails (\\x invalid in JSON)
    const response = `<|start|>assistant<|channel|>analysis to=vim code<|message|>{
  "file_path": "calc.py",
  "commands": [":e calc.py", "o", "text", "\\x1b", ":w"]
}`;
    const result = extractHarmonyToolCall(response);
    expect(result).not.toBeNull();
  });

  /**
   * Isolation: same format but with triple-quoted docstring. If this fails → \"\"\" is the cause.
   */
  it("parses analysis to=vim with triple-quoted docstring in commands", () => {
    const response = `<|start|>assistant<|channel|>analysis to=vim code<|message|>{
  "file_path": "calc.py",
  "commands": ["o", "    \\"\\"\\"Return the sum of a and b.\\"\\"\\"", "\\\\x1b", ":w"]
}`;
    const result = extractHarmonyToolCall(response);
    expect(result).not.toBeNull();
    expect(result!.arguments.commands[1]).toBe('    """Return the sum of a and b."""');
  });

  it("parses vim substitute command with escaped backslashes and hash (crc16.awk)", () => {
    const response = `<|start|>assistant<|channel|>analysis to=vim code<|message|>{
  "file_path": "crc16.awk",
  "commands": [
    ":%s/^\\\\/\\\\#/#/g",
    "gg",
    ":.,+24print"
  ]
}`;
    const result = extractHarmonyToolCall(response);
    expect(result).not.toBeNull();
    expect(result).toEqual({
      name: "vim",
      arguments: {
        file_path: "crc16.awk",
        commands: [
          ":%s/^\\/\\#/#/g",
          "gg",
          ":.,+24print",
        ],
      },
    });
  });

  /**
   * Regression: raw LLM output format (pretty-printed JSON with \x1b, triple-quoted docstring).
   * This format currently FAILS to parse — extractHarmonyToolCall returns null.
   * See: <|start|>assistant<|channel|>analysis to=vim code<|message|>{...}
   */
  it("parses raw vim code format — pretty-printed JSON with calc.py edit commands", () => {
    const response = `<|start|>assistant<|channel|>analysis to=vim code<|message|>{
  "file_path": "calc.py",
  "commands": [
    ":e calc.py",
    ":3",
    ":4,5d",
    "o",
    "    \\"\\"\\"Return the sum of a and b.\\"\\"\\"",
    "    return a + b",
    "\\x1b",
    ":w",
    ":%print #"
  ]
}`;
    const result = extractHarmonyToolCall(response);
    expect(result).not.toBeNull();
    expect(result).toEqual({
      name: "vim",
      arguments: {
        file_path: "calc.py",
        commands: [
          ":e calc.py",
          ":3",
          ":4,5d",
          "o",
          '    """Return the sum of a and b."""',
          "    return a + b",
          "\x1b",
          ":w",
          ":%print #",
        ],
      },
    });
  });

  /**
   * Regression: exact format from debug log - analysis to=vim code with :/N {/,$d
   */
  it("parses analysis to=vim with :/N {/,$d and END block commands", () => {
    const response = `<|end|><|start|>assistant<|channel|>analysis to=vim code<|message|>{
  "file_path": "crc16.awk",
  "commands": [
    ":/N {/,\$d",
    "G",
    "o",
    "#------------------------------------------------------------",
    "o",
    "# 4.  END block – finalize and print the result",
    "o",
    "#------------------------------------------------------------",
    "o",
    "END {",
    "    crc = crc16_finalize(crc)",
    "    printf \\"%04X\\\\n\\", and(crc, 0xFFFF)",
    "}",
    "\\x1b",
    ":w"
  ]
}
2`;
    const result = extractHarmonyToolCall(response);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("vim");
    expect(result!.arguments.file_path).toBe("crc16.awk");
    expect(result!.arguments.commands).toContain(":/N {/,$d");
    expect(result!.arguments.commands).toContain("END {");
  });

  /**
   * Regression: LLM sometimes outputs # comments in JSON (invalid JSON)
   */
  it("parses when JSON contains # line comments", () => {
    const response = `<|channel|>analysis to=vim code<|message|>{
  "file_path": "crc16.awk",
  "commands": [
    ":/N {/,\$d",
    "G",   # go to end of file
    "o",
    "END {",
    "\\x1b",
    ":w"
  ]
}`;
    const result = extractHarmonyToolCall(response);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("vim");
    expect(result!.arguments.commands).toContain("G");
    expect(result!.arguments.commands).toContain(":/N {/,$d");
  });
});
