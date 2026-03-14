// vimViewInstructions.ts
export const VIM_VIEW_INSTRUCTIONS = `
## How to Use VimView

VimView shows a live 24x80 terminal of your current file. You control it with the \`vim\` tool.

### Viewport (24 rows)
You see 24 lines at a time. You can edit ANY line in the file — the view automatically scrolls to show the cursor after each command. No need to navigate first; e.g. \`:36d\` or \`:36\` + edit works even when the view shows lines 1–24.

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
5. The view auto-scrolls to show the cursor — you can edit any line directly (e.g. \`:36d\`, \`:42s/old/new/\`)

### Common Commands:
- :e file.txt    - load file
- o              - open new line below for insert
- [type text]    - your text (as separate lines)
- \\x1b          - exit insert mode  
- :%print #      - view file with line numbers (use for accurate line refs)
- :w             - save
- gg             - go to top
- G              - go to bottom
- :42            - go to line 42 (1-based)
- :5d            - delete line 5
- :5,10d         - delete lines 5-10 (prefer range for contiguous)
- dd             - delete current line (position cursor with :N first)
- u              - undo
- ⚠️ Multiple deletes: higher line numbers first (bottom-to-top)

### Example - Create file:
<tool_call name="vim">
  <file_path>hello.py</file_path>
  <commands><![CDATA[
:e hello.py
o
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
print("New line 1")
print("New line 2")
\\x1b
:w
  ]]></commands>
</tool_call>

### Example - Edit a specific line (view auto-scrolls to show it):
<tool_call name="vim">
  <commands><![CDATA[
:36d            # delete line 36 (view scrolls to show result)
:.,+24print #  # verify
:w
  ]]></commands>
</tool_call>
`;