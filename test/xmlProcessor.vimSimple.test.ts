// test/xmlProcessor.vimSimple.test.ts
import { XmlProcessor } from "../src/utils/xmlProcessor";

describe("XmlProcessor - Vim commands with CDATA", () => {
  it("should parse vim_edit with three lines (apple, banana, orange)", () => {
    const text = 
      '<tool_call name="vim_edit">\n' +
      '  <file_path>fruits.txt</file_path>\n' +
      '  <commands><![CDATA[\n' +
      ':e fruits.txt\n' +
      'i\n' +
      'apple\n' +
      'banana\n' +
      'orange\n' +
      '\\x1b\n' +
      ':w\n' +
      ']]></commands>\n' +
      '</tool_call>';
    
    const result = XmlProcessor.extractToolCalls(text);
    
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("vim_edit");
    expect(result[0].args.file_path).toBe("fruits.txt");
    expect(Array.isArray(result[0].args.commands)).toBe(true);
    expect(result[0].args.commands).toEqual([
      ":e fruits.txt",
      "i",
      "apple",
      "banana",
      "orange",
      "\\x1b",
      ":w"
    ]);
  });

  it("should preserve the exact order of commands", () => {
    const text = 
      '<tool_call name="vim_edit">\n' +
      '  <file_path>test.txt</file_path>\n' +
      '  <commands><![CDATA[\n' +
      ':e test.txt\n' +
      'i\n' +
      'first\n' +
      'second\n' +
      'third\n' +
      '\\x1b\n' +
      ':wq\n' +
      ']]></commands>\n' +
      '</tool_call>';
    
    const result = XmlProcessor.extractToolCalls(text);
    
    const commands = result[0].args.commands;
    expect(commands[0]).toBe(":e test.txt");
    expect(commands[1]).toBe("i");
    expect(commands[2]).toBe("first");
    expect(commands[3]).toBe("second");
    expect(commands[4]).toBe("third");
    expect(commands[5]).toBe("\\x1b");
    expect(commands[6]).toBe(":wq");
    expect(commands.length).toBe(7);
  });
});
