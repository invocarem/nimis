// vimToolEssentials.ts
export const VIM_TOOL_ESSENTIALS = `
## VIM TOOL RULES

1. **Format:** ALWAYS use this:
   <tool_call name="vim">
     <commands><![CDATA[
   command1
   command2
     ]]></commands>
   </tool_call>

2. **Commands:** One per line in CDATA
3. **Insert mode:** Use \`i\` (insert at cursor) or \`o\` (new line below), then your text, then **\\x1b** (ESCAPE) to return to NORMAL mode
   - ⚠️ **CRITICAL:** You MUST include \\x1b after typing text, or you'll stay in insert mode forever!
   - ⚠️ NEVER write "ESC" or "Escape" - use \\x1b exactly

4. **Save:** Always :w after changes to save to disk
5. **Verify:** Use **:%print #** to see buffer content WITH line numbers (avoids off-by-one when referencing lines)
6. **NEVER** use JSON format or plain text - they WILL fail

### COMMAND EXAMPLES:

**Edit file (creates on :w if new):**
<tool_call name="vim">
  <file_path>hello.py</file_path>
  <commands><![CDATA[
:e hello.py
i
def main():
    print("hello")
\\x1b
:w
:%print #
  ]]></commands>
</tool_call>

**Edit existing file:**
<tool_call name="vim">
  <commands><![CDATA[
gg/def
o
    print("new line")
\\x1b
:w
:%print #
  ]]></commands>
</tool_call>

**Substitute (search/replace):**
<tool_call name="vim">
  <commands><![CDATA[
:%s/foo/bar/g
:w
:%print #
  ]]></commands>
</tool_call>

**Read file without editing:**
<tool_call name="vim">
  <file_path>existing.py</file_path>
  <commands><![CDATA[
:e existing.py
:%print #
:q
  ]]></commands>
</tool_call>

**Delete lines (use line numbers from :%print #):**
- :Nd         Delete line N (e.g. :5d)
- :N,Md       Delete lines N through M (e.g. :5,10d)
- ⚠️ Multiple non-contiguous lines: delete BOTTOM-TO-TOP (higher line numbers first), or line numbers shift!
  Example: to delete lines 3 and 7 → :7d then :3d (not :3d then :7d)
- :g/pat/d    Delete lines matching pattern

**Why \\x1b is CRITICAL:**
- Without it, next commands are typed as text, not executed!
- Example: After 'i' + text, you MUST have \\x1b before ':w'

**Why :%print # is HELPFUL:**
- Shows line numbers (1\tline1, 2\tline2...) — matches :N for navigation
- Avoids off-by-one when referencing "line 5" — use the number in the output
- Confirms your edits worked
`;