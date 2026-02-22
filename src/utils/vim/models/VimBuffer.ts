// src/utils/vim/models/VimBuffer.ts
import * as fs from "fs";
import { promisify } from "util";
import type { VimBuffer } from "../types";

const readFileAsync = promisify(fs.readFile);

export function createBuffer(
  filePath: string,
  content: string[],
  lineEnding: '\n' | '\r\n' = '\n'
): VimBuffer {
  const buffer: VimBuffer = {
    path: filePath,
    content,
    modified: false,
    currentLine: 0,
    marks: new Map(),
    registers: new Map(),
    lineEnding,
    lastRegister: undefined,
    lastSearch: undefined,
  };
  initDefaultRegisters(buffer, filePath); // Pass filePath to init function
  return buffer;
}

function initDefaultRegisters(buffer: VimBuffer, filePath: string): void {
  // Unnamed register
  buffer.registers.set('"', { type: 'linewise', content: [] });
  
  // Numbered registers 0-9
  for (let i = 0; i <= 9; i++) {
    buffer.registers.set(`${i}`, { type: 'linewise', content: [] });
  }
  
  // Named registers a-z
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(97 + i); // a-z
    buffer.registers.set(letter, { type: 'linewise', content: [] });
  }
  
  // Read-only registers (%, #, etc.)
  buffer.registers.set('%', { type: 'linewise', content: [filePath] });
}

export async function loadBufferFromFile(filePath: string): Promise<VimBuffer> {
  let content: string[];
  let lineEnding: '\n' | '\r\n' = '\n';

  try {
    const fileContent = await readFileAsync(filePath, 'utf-8');
    content = fileContent.split(/\r?\n/);
    if (content.length > 0 && content[content.length - 1] === '') {
      content.pop();
    }
    lineEnding = fileContent.includes('\r\n') ? '\r\n' : '\n';
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      content = [''];
    } else {
      throw error;
    }
  }

  return createBuffer(filePath, content, lineEnding);
}