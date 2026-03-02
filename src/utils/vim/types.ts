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

export interface UndoEntry {
  content: string[];
  currentLine: number;
  modified: boolean;
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
  /** Whether the file had a trailing newline when loaded. New buffers default to true. */
  trailingNewline?: boolean;
  lastRegister?: string;
  undoStack?: UndoEntry[];
}

export interface Range {
  start: number;
  end: number;
}

export interface VimOptions {
  expandtab: boolean;
  tabstop: number;
  softtabstop: number;
  shiftwidth: number;
  autoindent: boolean;
  number: boolean;
  relativenumber: boolean;
  wrapscan: boolean;
  ignorecase: boolean;
  smartcase: boolean;
  hlsearch: boolean;
  list: boolean;
}

export const VIM_OPTION_DEFAULTS: Readonly<VimOptions> = {
  expandtab: true,
  tabstop: 8,
  softtabstop: 0,
  shiftwidth: 8,
  autoindent: false,
  number: false,
  relativenumber: false,
  wrapscan: true,
  ignorecase: false,
  smartcase: false,
  hlsearch: false,
  list: false,
};

export const VIM_OPTION_ALIASES: Record<string, keyof VimOptions> = {
  et: 'expandtab',
  ts: 'tabstop',
  sts: 'softtabstop',
  sw: 'shiftwidth',
  ai: 'autoindent',
  nu: 'number',
  rnu: 'relativenumber',
  ws: 'wrapscan',
  ic: 'ignorecase',
  scs: 'smartcase',
  hls: 'hlsearch',
  li: 'list',
};

export const VIM_BOOLEAN_OPTIONS = new Set<keyof VimOptions>([
  'expandtab', 'autoindent', 'number', 'relativenumber',
  'wrapscan', 'ignorecase', 'smartcase', 'hlsearch', 'list',
]);

/**
 * Shared mutable state passed to command handlers and operations.
 */
export interface CommandContext {
  buffers: Map<string, VimBuffer>;
  getCurrentBuffer(): VimBuffer | null;
  setCurrentBuffer(buffer: VimBuffer | null): void;
  resolvePath(filePath: string): string;
  readonly workingDir?: string;
  readonly options: VimOptions;
}
