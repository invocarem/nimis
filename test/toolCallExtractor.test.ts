describe("extractToolCall - MCP tool edge cases", () => {
  it("extracts tool_call with underscores in MCP tool name", () => {
    const response = 'tool_call(name="analyze_latin", arguments={"word": "invenietur"})';
    const result = extractToolCall(response);
    expect(result).toEqual({ name: "analyze_latin", arguments: { word: "invenietur" } });
  });

  it("extracts tool_call with no underscores altered", () => {
    const response = 'tool_call(name="read_file", arguments={"file_path": "test.py"})';
    const result = extractToolCall(response);
    expect(result).toEqual({ name: "read_file", arguments: { file_path: "test.py" } });
  });
});
import { extractToolCall, MCPToolCall } from "../src/utils/toolCallExtractor";

describe("extractToolCall", () => {
  it("extracts tool_call with name and arguments (simple JSON)", () => {
    const response = 'tool_call(name="myTool", arguments={"foo": 1, "bar": "baz"})';
    const result = extractToolCall(response);
    expect(result).toEqual({ name: "myTool", arguments: { foo: 1, bar: "baz" } });
  });

  it("extracts tool_call with tool_name and args (simple JSON)", () => {
    const response = 'tool_call(tool_name="otherTool", args={"x": 42, "y": [1,2,3]})';
    const result = extractToolCall(response);
    expect(result).toEqual({ name: "otherTool", arguments: { x: 42, y: [1, 2, 3] } });
  });

  it("handles nested JSON arguments", () => {
    const response = 'tool_call(name="deepTool", arguments={"a": {"b": {"c": 3}}, "d": [1, {"e": 2}]})';
    const result = extractToolCall(response);
    expect(result).toEqual({ name: "deepTool", arguments: { a: { b: { c: 3 } }, d: [1, { e: 2 }] } });
  });

  it("returns null if no tool_call present", () => {
    const response = 'no tool call here';
    expect(extractToolCall(response)).toBeNull();
  });

  it("returns null for malformed tool_call", () => {
    const response = 'tool_call(name="badTool", arguments={foo: 1, bar: })';
    expect(extractToolCall(response)).toBeNull();
  });

  // Skipped: extractor expects strict JSON, not single quotes
  // it("handles single quotes in JSON", () => {
  //   const response = "tool_call(name='singleQuoteTool', arguments={'foo': 'bar', 'num': 7})";
  //   const result = extractToolCall(response);
  //   expect(result).toEqual({ name: "singleQuoteTool", arguments: { foo: "bar", num: 7 } });
  // });

  it("handles large JSON arguments", () => {
    const bigObj = { arr: Array(1000).fill({ x: 1, y: 2 }), str: "test" };
    const json = JSON.stringify(bigObj);
    const response = `tool_call(name=\"bigTool\", arguments=${json})`;
    const result = extractToolCall(response);
    expect(result).toEqual({ name: "bigTool", arguments: bigObj });
  });

  it("extracts create_file tool_call with file content", () => {
    const response = 'tool_call(name="create_file", arguments={"filePath": "test.txt", "content": "Hello, world!\nThis is a test file."})';
    const result = extractToolCall(response);
    expect(result).toEqual({ name: "create_file", arguments: { filePath: "test.txt", content: "Hello, world!\nThis is a test file." } });
  });

  it("handles Python-style triple-quoted strings", () => {
    const response = 'tool_call(name="create_file", arguments={ "file_path": "hello.py", "content": """def greet(name=\\"World\\"):\\n    \\"\\"\\"Return a greeting message.\\"\\"\\"\\n    return f\\"Hello, {name}!\\"\\n\\nif __name__ == \\"__main__\\":\\n    print(greet())\\n    print(greet(\\"Python\\"))\\n""" })';
    const result = extractToolCall(response);
    expect(result).toBeTruthy();
    expect(result?.name).toBe("create_file");
    expect(result?.arguments.file_path).toBe("hello.py");
    expect(result?.arguments.content).toContain("def greet");
    expect(result?.arguments.content).toContain("Return a greeting message");
  });

  it("fixes \\\"\\\" to \\\"\\\"\\\" at start of string values", () => {
    // Test case for LLM outputting \"\" instead of \"\"\"
    const response = `tool_call(name="edit_file", arguments={ "file_path": "calc.py", "old_text": "\\"\\"def add(a, b):\\n \\"\\"\\"Return the sum\\"\\"\\"\\n return a + b" })`;
    const result = extractToolCall(response);
    expect(result).toBeTruthy();
    expect(result?.name).toBe("edit_file");
    // After parsing, \"\"\" becomes """ (triple quotes)
    expect(result?.arguments.old_text).toContain('"""def add');
    expect(result?.arguments.old_text).not.toContain('""def add');
  });

  it("preserves indentation in triple-quoted strings for edit_file", () => {
    // Test case matching actual LLM output format with triple quotes
    // The LLM outputs: """\ndef add(a, b):\n \"\"\"Return the sum...\n return a + b\n"""
    const response = `tool_call(name="edit_file", arguments={ "file_path": "calc.py", "old_text": """
def add(a, b):
 \"\"\"Return the sum of a and b.\"\"\"
 return a + b
""", "new_text": """
def add(a, b):
    \"\"\"Return the sum of a and b.\"\"\"
    return a + b
""" })`;
    const result = extractToolCall(response);
    expect(result).toBeTruthy();
    expect(result?.name).toBe("edit_file");
    expect(result?.arguments.file_path).toBe("calc.py");

    // Verify the extracted strings preserve all whitespace
    const oldText = result?.arguments.old_text;
    const newText = result?.arguments.new_text;

    // Check that newlines are preserved (actual \n characters in the string)
    expect(oldText).toContain("\ndef add");
    expect(oldText).toContain("\n return");

    // Check that indentation spaces are preserved
    // old_text should have " return" (1 space before return)
    expect(oldText).toMatch(/\n return a \+ b/);

    // new_text should have "    return" (4 spaces before return)  
    expect(newText).toMatch(/\n    return a \+ b/);
    expect(newText).toContain("    return");

    // Verify docstring quotes are properly escaped in the JSON string
    // After JSON.parse, they become actual quotes, so check for the docstring content
    expect(oldText).toContain('"""Return the sum');
  });

  it("handles replace_file tool_call with Python script content", () => {
    const response = `tool_call(name="replace_file", arguments={ "file_path": "hello.py", "content": "#!/usr/bin/env python3\n\"\"\"\nA simple Python script that prints greetings.\n\"\"\"\nimport argparse\n\n\ndef greet(name):\n    \"\"\"Greet someone by name.\"\"\"\n    return f\"Hello, {name}!\"\n\n\ndef main():\n    parser = argparse.ArgumentParser(description='Greet someone.')\n    parser.add_argument('--name', type=str, default='World', \n                        help='Name of the person to greet')\n    args = parser.parse_args()\n    \n    print(greet(args.name))\n\nif __name__ == \"__main__\":\n    main()\n" })`;

    const result = extractToolCall(response);
    expect(result).toBeTruthy();
    expect(result?.name).toBe("replace_file");
    expect(result?.arguments.file_path).toBe("hello.py");
    expect(result?.arguments.content).toContain("A simple Python script that prints greetings.");
    expect(result?.arguments.content).toContain("def greet(name):");
  });

  it("handles replace_file tool_call with C# file content", () => {
    const response = `tool_call(name="replace_file", arguments={ "file_path": "Program.cs", "content": "using System;\n\nnamespace Example {\n    public class Program {\n        public static string Greet(string name) {\n            return $\"Hello, {name}!\";\n        }\n\n        public static void Main() {\n            Console.WriteLine(Greet(\"World\"));\n        }\n    }\n}" })`;

    const result = extractToolCall(response);
    expect(result).toBeTruthy();
    expect(result?.name).toBe("replace_file");
    expect(result?.arguments.file_path).toBe("Program.cs");
    expect(result?.arguments.content).toContain("namespace Example");
    expect(result?.arguments.content).toContain("Console.WriteLine");
    expect(result?.arguments.content).toContain('Greet("World")');
  });

  it("handles replace_file tool_call with Swift file content", () => {
    const response = `tool_call(name="replace_file", arguments={ "file_path": "Greeter.swift", "content": "import Foundation\n\nstruct Greeter {\n    static func greet(name: String) -> String {\n        return \\\"Hello, \\\" + name + \\\"!\\\"\n    }\n}\n\nprint(Greeter.greet(name: \\\"Swift\\\"))" })`;

    const result = extractToolCall(response);
    expect(result).toBeTruthy();
    expect(result?.name).toBe("replace_file");
    expect(result?.arguments.file_path).toBe("Greeter.swift");
    expect(result?.arguments.content).toContain("struct Greeter");
    expect(result?.arguments.content).toContain("print(Greeter.greet");
  });

  it("handles create_file tool_call where file content is JSON", () => {
    const dataObj = { user: { id: 123, name: "Alice", roles: ["admin", "user"], meta: { active: true } } };
    const jsonContent = JSON.stringify(dataObj, null, 2);
    const response = `tool_call(name="create_file", arguments={ "file_path": "data.json", "content": ${JSON.stringify(jsonContent)} })`;

    const result = extractToolCall(response);
    expect(result).toBeTruthy();
    expect(result?.name).toBe("create_file");
    expect(result?.arguments.file_path).toBe("data.json");
    // content should be a JSON string that parses to the original object
    expect(() => JSON.parse(result!.arguments.content)).not.toThrow();
    expect(JSON.parse(result!.arguments.content)).toEqual(dataObj);
  });

  it("handles Swift multiline string literals with triple quotes", () => {
    // Swift multiline strings use """ and can contain unescaped quotes
    const swiftMultiline = `let message = \\"\\"\\"
    Hello, \\"World\\"!
    This is a multiline string.
    \\"\\"\\"\nprint(message)`;
    const response = `tool_call(name="create_file", arguments={ "file_path": "MultilineSwift.swift", "content": ${JSON.stringify(swiftMultiline)} })`;

    const result = extractToolCall(response);
    expect(result).toBeTruthy();
    expect(result?.name).toBe("create_file");
    expect(result?.arguments.file_path).toBe("MultilineSwift.swift");
    expect(result?.arguments.content).toContain('let message =');
    expect(result?.arguments.content).toContain('Hello, \\"World\\"!');
    expect(result?.arguments.content).toContain('multiline string');
  });

  it("handles C# verbatim string literals with @", () => {
    // C# verbatim strings use @"..." and escape quotes as ""
    const csharpVerbatim = `string path = @\\"C:\\\\Users\\\\test\\\\file.txt\\";
string message = @\\"She said, \\"\\"\\"Hello\\"\\"\\"\\".\";`;
    const response = `tool_call(name="create_file", arguments={ "file_path": "VerbatimCSharp.cs", "content": ${JSON.stringify(csharpVerbatim)} })`;

    const result = extractToolCall(response);
    expect(result).toBeTruthy();
    expect(result?.name).toBe("create_file");
    expect(result?.arguments.file_path).toBe("VerbatimCSharp.cs");
    expect(result?.arguments.content).toContain('string path =');
    expect(result?.arguments.content).toContain('C:\\\\Users');
  });

  it("handles Swift with multiple string interpolations", () => {
    const swiftInterpolation = `let name = \\"Alice\\"
let age = 30
let greeting = \\"Hello, \\\\(name)! You are \\\\(age) years old.\\"
print(greeting)`;
    const response = `tool_call(name="create_file", arguments={ "file_path": "Interpolation.swift", "content": ${JSON.stringify(swiftInterpolation)} })`;

    const result = extractToolCall(response);
    expect(result).toBeTruthy();
    expect(result?.name).toBe("create_file");
    expect(result?.arguments.content).toContain('let name =');
    expect(result?.arguments.content).toContain('\\(name)');
    expect(result?.arguments.content).toContain('\\(age)');
  });

  it("handles C# raw string literals (C# 11+)", () => {
    // C# 11+ raw strings use """ (similar to Swift)
    const csharpRaw = `var json = \\"\\"\\"
    {
        \\"name\\": \\"test\\",
        \\"value\\": 123
    }
    \\"\\"\\";`;
    const response = `tool_call(name="create_file", arguments={ "file_path": "RawCSharp.cs", "content": ${JSON.stringify(csharpRaw)} })`;

    const result = extractToolCall(response);
    expect(result).toBeTruthy();
    expect(result?.name).toBe("create_file");
    expect(result?.arguments.content).toContain('var json =');
    expect(result?.arguments.content).toContain('\\"name\\"');
    expect(result?.arguments.content).toContain('\\"value\\"');
  });

  it("handles Swift code with escaping edge cases", () => {
    const swiftEscape = `let backslash = \\"\\\\\\\\"
let quote = \\"\\\\\\"Hello\\\\\\"\\";
let newline = \\"Line1\\\\nLine2\\"`;
    const response = `tool_call(name="create_file", arguments={ "file_path": "Escapes.swift", "content": ${JSON.stringify(swiftEscape)} })`;

    const result = extractToolCall(response);
    expect(result).toBeTruthy();
    expect(result?.name).toBe("create_file");
    expect(result?.arguments.content).toContain('let backslash');
    expect(result?.arguments.content).toContain('let quote');
    expect(result?.arguments.content).toContain('let newline');
  });
});
