// In a new file: src/operations/DirectoryOperations.ts
import * as fs from "fs";
import * as path from "path";
import type { VimBuffer, CommandContext } from "../types";
export async function listDirectory(
  dirPath: string,
  ctx: CommandContext
): Promise<string> {
  const files = await fs.promises.readdir(dirPath);

  // Create a virtual buffer content
  const content = [
    `" Directory: ${dirPath}`,
    `" Use :e <file> to open a file`,
    `" Use :cd <dir> to change directory`,
    "",
    ...files.map((f) => {
      const fullPath = path.join(dirPath, f);
      try {
        const stat = fs.statSync(fullPath);
        return stat.isDirectory() ? `${f}/` : f;
      } catch {
        return f;
      }
    }),
  ];
  // Determine line ending based on platform or default to '\n'
  const lineEnding = process.platform === "win32" ? "\r\n" : "\n";
  // Create a temporary buffer
  const tempBuffer: VimBuffer = {
    path: dirPath,
    content: content,
    modified: false,
    currentLine: 0,
    registers: new Map(),
    marks: new Map(),
    lastRegister: undefined,
    lineEnding: lineEnding,
  };

  ctx.setCurrentBuffer(tempBuffer);

  return `" ${dirPath}" [Directory] ${content.length} lines`;
}
