const { formatMarkdown } = require("../src/webview/assets/markdownFormatter");

describe("formatMarkdown - Italic Text Handling", () => {
  test("should not trim underscores in code or variable names", () => {
    const input = "This is a variable_name and _italic_ text.";
    const expectedOutput = "<p>This is a variable_name and <em>italic</em> text.</p>";

    const result = formatMarkdown(input);

    expect(result).toBe(expectedOutput);
  });

  test("should handle inline code with underscores correctly", () => {
    const input = "Here is `variable_name` and _italic_ text.";
    const expectedOutput = "<p>Here is <code class=\"inline-code\">variable_name</code> and <em>italic</em> text.</p>";

    const result = formatMarkdown(input);

    expect(result).toBe(expectedOutput);
  });
});