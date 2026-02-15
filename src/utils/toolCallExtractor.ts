/**
 * Preprocesses a JSON-like string to make it safe for JSON.parse.
 * Handles literal newlines and unescaped quotes in string values.
 */
function safeJsonParse(jsonStr: string): any {
  // Try standard JSON parsing first
  try {
    return JSON.parse(jsonStr);
  } catch (firstError) {
    // JSON is malformed, likely due to unescaped quotes or literal newlines in content
    // Process character-by-character to fix it
    
    let result = '';
    let i = 0;
    let inString = false;
    let expectingKey = false; // Track if next string is a JSON key
    let depth = 0; // Brace depth to track object nesting
    
    while (i < jsonStr.length) {
      const char = jsonStr[i];
      const next = i < jsonStr.length - 1 ? jsonStr[i + 1] : '';
      
      // Handle escape sequences
      if (char === '\\' && inString) {
        result += char;
        if (next) {
          result += next;
          i += 2;
        } else {
          i++;
        }
        continue;
      }
      
      // Track object depth when not in strings
      if (!inString) {
        if (char === '{') {
          depth++;
          expectingKey = true; // After {, we expect a key (or })  
          result += char;
          i++;
          continue;
        } else if (char === '}') {
          depth--;
          expectingKey = false;
          result += char;
          i++;
          continue;
        } else if (char === ',' && depth > 0) {
          expectingKey = true; // After , in an object, we expect a key
          result += char;
          i++;
          continue;
        }
      }
      
      // Handle quotes
      if (char === '"') {
        if (!inString) {
          // Starting a string
          inString = true;
          result += char;
          i++;
          continue;
        } else {
          // Could be end of string OR embedded quote
          // Look ahead to see what follows
          const afterQuote = jsonStr.substring(i + 1).match(/^\s*([,:}\]])/);
          
          if (afterQuote) {
            const nextToken = afterQuote[1];
            // Closing quote if:
            // - Followed by : and we're expecting a key
            // - Followed by , } ] (end of value)
            const isClosing = (nextToken === ':' && expectingKey) || (nextToken === ',' || nextToken === '}' || nextToken === ']');
            
            if (isClosing) {
              // End of string
              inString = false;
              if (nextToken === ':') {
                expectingKey = false; // After :, we expect a value
              }
              result += char;
              i++;
              continue;
            }
          }
          
          // Embedded quote - escape it
          result += '\\' + char;
          i++;
          continue;
        }
      }
      
      // Handle control characters inside strings
      if (inString) {
        if (char === '\n') {
          result += '\\n';
        } else if (char === '\r') {
          result += '\\r';
        } else if (char === '\t') {
          result += '\\t';
        } else {
          result += char;
        }
      } else {
        // Outside strings, just copy
        result += char;
      }
      
      i++;
    }
    
    // Remove trailing commas
    result = result.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
    
    return JSON.parse(result);
  }
}
/**
 * Utility to robustly extract tool calls from LLM responses.
 * Supports tool_call(name="...", arguments={...}) or tool_call(tool_name="...", args={...})
 * Handles large/complex JSON arguments.
 */

export interface MCPToolCall {
  name: string;
  arguments: any;
}

/**
 * Extracts a tool call from a string, supporting large/nested JSON arguments.
 * Returns null if no valid tool call is found.
 */
export function extractToolCall(response: string): MCPToolCall | null {
  // Find the start of tool_call(
  const callStart = response.indexOf("tool_call(");
  if (callStart === -1) return null;

  // Find the opening parenthesis
  const openParen = response.indexOf("(", callStart);
  if (openParen === -1) return null;

  // Find the closing parenthesis (robust, supports nested and multiline)
  let i = openParen + 1;
  let depth = 1;
  let end = -1;
  while (i < response.length) {
    if (response[i] === "(") depth++;
    else if (response[i] === ")") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
    i++;
  }
  if (end === -1) return null;
  const inside = response.slice(openParen + 1, end);

  // Try to extract name/tool_name and arguments/args
  // Use regex to find name/tool_name, then find the JSON object for arguments/args
  const nameMatch = inside.match(/(name|tool_name)\s*=\s*"([^"]+)"/);
  if (!nameMatch) return null;
  const name = nameMatch[2];

  // Find arguments/args key
  const argsKeyMatch = inside.match(/(arguments|args)\s*=/);
  if (!argsKeyMatch) return null;
  const argsKey = argsKeyMatch[1];
  const argsKeyIdx = inside.indexOf(argsKeyMatch[0]) + argsKeyMatch[0].length;

  // Find the start of the JSON object
  let jsonStart = inside.indexOf("{", argsKeyIdx);
  if (jsonStart === -1) return null;
  // Find the end of the JSON object (brace matching, supports multiline and escaped braces)
  let braceDepth = 1;
  let j = jsonStart + 1;
  let inString = false;
  let escape = false;
  while (j < inside.length && braceDepth > 0) {
    const ch = inside[j];
    if (escape) {
      escape = false;
    } else if (ch === '\\') {
      escape = true;
    } else if (ch === '"') {
      inString = !inString;
    } else if (!inString) {
      if (ch === "{") braceDepth++;
      else if (ch === "}") braceDepth--;
    }
    j++;
  }
  if (braceDepth !== 0) return null;
  const jsonStr = inside.slice(jsonStart, j);

  // Try to parse JSON (fix single quotes, trailing commas, etc. if needed)
  try {
    const args = safeJsonParse(jsonStr);
    return { name, arguments: args };
  } catch (e: any) {
    return null;
  }
}
