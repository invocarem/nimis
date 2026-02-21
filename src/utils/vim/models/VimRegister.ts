// src/models/VimRegister.ts
import type { VimBuffer, VimRegister } from "../types";

export function getRegister(buffer: VimBuffer, name: string): VimRegister | undefined {
  return buffer.registers.get(name);
}

export function setRegister(buffer: VimBuffer, name: string, register: VimRegister): void {
  buffer.registers.set(name, register);
}

export function shiftDeleteRegisters(buffer: VimBuffer, deletedContent: string[]): void {
  for (let i = 9; i > 1; i--) {
    const prev = buffer.registers.get(`${i - 1}`);
    if (prev && prev.content && (Array.isArray(prev.content) ? prev.content.length > 0 : prev.content)) {
      buffer.registers.set(`${i}`, { ...prev });
    }
  }
  buffer.registers.set('1', { type: 'linewise', content: [...deletedContent] });
}

export function formatRegisters(buffer: VimBuffer): string {
  const lines: string[] = [];
  
  // Sort registers in a logical order: ", 0-9, a-z
  const registers = Array.from(buffer.registers.entries())
    .sort(([a], [b]) => {
      if (a === '"') return -1;
      if (b === '"') return 1;
      if (!isNaN(Number(a)) && isNaN(Number(b))) return -1;
      if (isNaN(Number(a)) && !isNaN(Number(b))) return 1;
      return a.localeCompare(b);
    });

  for (const [name, reg] of registers) {
    // Skip internal registers we don't want to show
    if (name === '%' || name === '#') continue;
    
    if (reg.content && (Array.isArray(reg.content) ? reg.content.length > 0 : reg.content)) {
      let contentStr: string;
      if (Array.isArray(reg.content)) {
        contentStr = reg.content.join('^J');
        if (contentStr.length > 50) {
          contentStr = contentStr.substring(0, 47) + '...';
        }
      } else {
        contentStr = reg.content.substring(0, 50);
        if (reg.content.length > 50) {
          contentStr += '...';
        }
      }
      // Replace newlines with ^J for display
      contentStr = contentStr.replace(/\n/g, '^J');
      lines.push(`"${name}   ${contentStr}`);
    } else {
      // Show empty registers
      lines.push(`"${name}   (empty)`);
    }
  }

  return lines.length === 0 ? "No registers" : lines.join('\n');
}