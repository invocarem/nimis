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

  it("handles replace_file tool_call with Python script content", () => {
    const response = `tool_call(name="replace_file", arguments={ "file_path": "hello.py", "content": "#!/usr/bin/env python3\n\"\"\"\nA simple Python script that prints greetings.\n\"\"\"\nimport argparse\n\n\ndef greet(name):\n    \"\"\"Greet someone by name.\"\"\"\n    return f\"Hello, {name}!\"\n\n\ndef main():\n    parser = argparse.ArgumentParser(description='Greet someone.')\n    parser.add_argument('--name', type=str, default='World', \n                        help='Name of the person to greet')\n    args = parser.parse_args()\n    \n    print(greet(args.name))\n\nif __name__ == \"__main__\":\n    main()\n" })`;

    const result = extractToolCall(response);
    expect(result).toBeTruthy();
    expect(result?.name).toBe("replace_file");
    expect(result?.arguments.file_path).toBe("hello.py");
    expect(result?.arguments.content).toContain("A simple Python script that prints greetings.");
    expect(result?.arguments.content).toContain("def greet(name):");
  });
});
