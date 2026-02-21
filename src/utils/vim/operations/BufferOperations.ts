
// src/operations/BufferOperations.ts
import * as path from "path";
import type { VimBuffer, VimToolResult } from "../types";
import { formatRegisters } from "../models/VimRegister";

export function formatBufferList(
  buffers: Map<string, VimBuffer>,
  currentBuffer: VimBuffer | null
): string {
  const lines: string[] = [];
  let index = 1;

  for (const [, buffer] of buffers) {
    const current = buffer === currentBuffer ? '%' : ' ';
    const modified = buffer.modified ? '+' : ' ';
    lines.push(`${current}${modified} ${index++} "${buffer.path}" ${buffer.content.length}L`);
  }

  return lines.length === 0 ? "No buffers open" : lines.join('\n');
}

export function listBuffers(
  buffers: Map<string, VimBuffer>,
  currentBuffer: VimBuffer | null
): VimToolResult {
  return {
    content: [{
      type: "text",
      text: formatBufferList(buffers, currentBuffer)
    }]
  };
}

export function showRegisters(currentBuffer: VimBuffer | null): VimToolResult {
  if (!currentBuffer) {
    // Return default registers even with no active buffer
    const defaultRegisters = new Map<string, { type: string, content: string[] }>();
    
    // Initialize default registers
    defaultRegisters.set('"', { type: 'linewise', content: [] });
    for (let i = 0; i <= 9; i++) {
      defaultRegisters.set(`${i}`, { type: 'linewise', content: [] });
    }
    for (let i = 0; i < 26; i++) {
      const letter = String.fromCharCode(97 + i);
      defaultRegisters.set(letter, { type: 'linewise', content: [] });
    }
    
    // Create a mock buffer just for formatting registers
    const mockBuffer = {
      registers: defaultRegisters
    } as VimBuffer;
    
    return {
      content: [{
        type: "text",
        text: formatRegisters(mockBuffer)
      }]
    };
  }

  return {
    content: [{
      type: "text",
      text: formatRegisters(currentBuffer)
    }]
  };
}

export function showMarks(currentBuffer: VimBuffer | null): VimToolResult {
  if (!currentBuffer) {
    return {
      content: [{ type: "text", text: "No active buffer" }]
    };
  }

  const lines: string[] = [];
  for (const [mark, line] of currentBuffer.marks) {
    const content = currentBuffer.content[line]?.substring(0, 50) || '';
    lines.push(` '${mark}  ${line + 1}    ${content}`);
  }

  if (lines.length === 0) {
    return {
      content: [{ type: "text", text: "No marks set" }]
    };
  }

  return {
    content: [{
      type: "text",
      text: "mark line  content\n" + lines.join('\n')
    }]
  };
}


export function getNextBuffer(
  buffers: Map<string, VimBuffer>,
  currentBuffer: VimBuffer | null
): VimBuffer | null {
  const all = Array.from(buffers.values());
  if (all.length === 0) return null;
  if (!currentBuffer) return all[0];

  const currentIndex = all.findIndex(b => b.path === currentBuffer.path);
  return all[(currentIndex + 1) % all.length];
}

export function getPreviousBuffer(
  buffers: Map<string, VimBuffer>,
  currentBuffer: VimBuffer | null
): VimBuffer | null {
  const all = Array.from(buffers.values());
  if (all.length === 0) return null;
  if (!currentBuffer) return all[0];

  const currentIndex = all.findIndex(b => b.path === currentBuffer.path);
  return all[(currentIndex - 1 + all.length) % all.length];
}

export async function switchToBuffer(
  arg: string,
  buffers: Map<string, VimBuffer>
): Promise<VimBuffer> {
  const num = parseInt(arg, 10);
  if (!isNaN(num)) {
    const all = Array.from(buffers.values());
    if (num >= 1 && num <= all.length) {
      return all[num - 1];
    }
  }

  for (const buffer of buffers.values()) {
    if (path.basename(buffer.path).includes(arg)) {
      return buffer;
    }
  }

  throw new Error(`Buffer not found: ${arg}`);
}
