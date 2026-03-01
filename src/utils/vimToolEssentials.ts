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
3. **Insert mode:** Use 'i' then your text, then **\\x1b** (ESCAPE) to return to NORMAL mode
   - ⚠️ **CRITICAL:** You MUST include \\x1b after typing text, or you'll stay in insert mode forever!
   - ⚠️ NEVER write "ESC" or "Escape" - use \\x1b exactly

4. **Save:** Always :w after changes to save to disk
5. **Verify:** Use **:%print** to see the current buffer content in the response
6. **NEVER** use JSON format or plain text - they WILL fail

### COMMAND EXAMPLES:

**Create new file:**
<tool_call name="vim">
  <file_path>hello.py</file_path>
  <commands><![CDATA[
:e hello.py
i
def main():
    print("hello")
\\x1b           # ← MUST exit insert mode!
:w
:%print        # ← verify the file content
  ]]></commands>
</tool_call>

**Edit existing file:**
<tool_call name="vim">
  <commands><![CDATA[
gg/def
o
    print("new line")
\\x1b           # ← MUST exit insert mode!
:w
:%print        # ← verify the changes
  ]]></commands>
</tool_call>

**Substitute (search/replace):**
<tool_call name="vim">
  <commands><![CDATA[
:%s/foo/bar/g     # replace all 'foo' with 'bar'
:w
:%print           # ← verify the replacements
  ]]></commands>
</tool_call>

**Read file without editing:**
<tool_call name="vim">
  <file_path>existing.py</file_path>
  <commands><![CDATA[
:e existing.py
:%print           # ← just view the file content
:q                # ← quit without saving
  ]]></commands>
</tool_call>

**Why \\x1b is CRITICAL:**
- Without it, next commands are typed as text, not executed!
- Example: After 'i' + text, you MUST have \\x1b before ':w'

**Why :%print is HELPFUL:**
- Shows you exactly what's in the buffer
- Confirms your edits worked
- Lets you see the file without guessing
`;