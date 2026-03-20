/**
 * Parse chat input for @ directives. Pure function, no dependencies.
 * Supports: @vim, @file, @mcp, @@ (literal), and unknown @xxx.
 * Requires space after directive name (e.g. @vim dd, not @vimdd).
 */

export type ChatDirective =
  | { kind: "normal"; message: string }
  | { kind: "literal"; message: string }
  | { kind: "vim"; command: string }
  | { kind: "file"; path: string }
  | { kind: "mcp"; payload: string }
  | { kind: "unknown"; directive: string; payload: string };

export function parseChatDirective(message: string): ChatDirective {
  const trimmed = message.trim();
  if (!trimmed.startsWith("@")) {
    return { kind: "normal", message: trimmed };
  }
  if (trimmed.startsWith("@@")) {
    return { kind: "literal", message: trimmed.slice(1) };
  }
  const match = trimmed.match(/^@(\w+)(?:\s+(.*))?$/s);
  if (!match) {
    return { kind: "normal", message: trimmed };
  }
  const [, directive, payload = ""] = match;
  const payloadTrimmed = payload.trimEnd();
  switch (directive.toLowerCase()) {
    case "vim":
      return { kind: "vim", command: payloadTrimmed };
    case "file":
      return { kind: "file", path: payloadTrimmed };
    case "mcp":
      return { kind: "mcp", payload: payloadTrimmed };
    default:
      return { kind: "unknown", directive, payload: payloadTrimmed };
  }
}
