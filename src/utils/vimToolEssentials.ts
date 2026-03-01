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
3. **Insert mode:** Use 'i' then your text, then \\x1b
4. **Save:** Always :w after changes
5. **NEVER** use JSON format or plain text

✅ GOOD:
<tool_call name="vim">
  <commands><![CDATA[
:e file.txt
i
Hello World
\\x1b
:w
  ]]></commands>
</tool_call>

❌ BAD (will fail):
<tool_call name="vim" args='{"commands":["i","Hello"]}' />
`;