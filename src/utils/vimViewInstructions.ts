// vimViewInstructions.ts
export const VIM_VIEW_INSTRUCTIONS = `
## How to Use VimView

VimView shows a live 24x80 terminal of your current file. You control it with the \`vim\` tool.

### Basic Format (ALWAYS use this):
<tool_call name="vim">
  <file_path>file.py</file_path>  <!-- optional -->
  <commands><![CDATA[
command1
command2
command3
  ]]></commands>
</tool_call>

### Rules:
1. Each command on its own line in CDATA
2. Use \\x1b to exit insert mode (NOT "ESC")
3. Wait for result before next tool call
4. VimView updates automatically

### Common Commands:
- :e file.txt    - load file
- i              - enter insert mode
- [type text]    - your text (as separate lines)
- \\x1b           - exit insert mode  
- :w             - save
- gg             - go to top
- G              - go to bottom
- :42            - go to line 42
- dd             - delete line
- u              - undo

### Example - Create file:
<tool_call name="vim">
  <file_path>hello.py</file_path>
  <commands><![CDATA[
:e hello.py
i
print("Hello")
print("World")
\\x1b
:w
  ]]></commands>
</tool_call>

### Example - Edit file:
<tool_call name="vim">
  <commands><![CDATA[
gg/print
o
print("New line")
\\x1b
:w
  ]]></commands>
</tool_call>
`;