// src/utils/vim/models/VimMode.ts
import type { VimBuffer} from "../types";
export type VimMode = 'normal' | 'insert' | 'command-line';

export interface VimState {
  mode: VimMode;
  buffer: VimBuffer | null;
  commandBuffer: string; // For building commands in command-line mode
  lastCommand?: string;
  pendingCommand?: string; // For multi-key commands
  cursorPosition: { line: number; column: number };
}

export function createVimState(buffer?: VimBuffer): VimState {
  return {
    mode: 'normal',
    buffer: buffer || null,
    commandBuffer: '',
    cursorPosition: { line: 0, column: 0 }
  };
}
