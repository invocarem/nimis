export interface VimTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface VimToolResult {
  content: Array<{
    type: string;
    text?: string;
    [key: string]: any;
  }>;
  isError?: boolean;
}

export interface VimRegister {
  type: 'linewise' | 'characterwise' | 'blockwise';
  content: string | string[];
}

export interface VimBuffer {
  path: string;
  content: string[];
  modified: boolean;
  currentLine: number;
  marks: Map<string, number>;
  registers: Map<string, VimRegister>;
  lastSearch?: RegExp;
  lineEnding: '\n' | '\r\n';
  lastRegister?: string;
}

export interface Range {
  start: number;
  end: number;
}

/**
 * Shared mutable state passed to command handlers and operations.
 */
export interface CommandContext {
  buffers: Map<string, VimBuffer>;
  getCurrentBuffer(): VimBuffer | null;
  setCurrentBuffer(buffer: VimBuffer | null): void;
  resolvePath(filePath: string): string;
}
