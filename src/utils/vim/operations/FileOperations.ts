import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { promisify } from "util";
import { exec } from "child_process";
import type { VimBuffer, CommandContext } from "../types";
import { loadBufferFromFile } from "../models/VimBuffer";

const readFileAsync = promisify(fs.readFile);
const writeFileAsync = promisify(fs.writeFile);
const mkdirAsync = promisify(fs.mkdir);

export async function editFile(
  filePath: string,
  ctx: CommandContext
): Promise<VimBuffer> {
  const resolvedPath = ctx.resolvePath(filePath);

  let buffer = ctx.buffers.get(resolvedPath);
  if (!buffer) {
    buffer = await loadBufferFromFile(resolvedPath);
    ctx.buffers.set(resolvedPath, buffer);
  }

  ctx.setCurrentBuffer(buffer);
  return buffer;
}

export async function writeBuffer(buffer: VimBuffer): Promise<void> {
  const dir = path.dirname(buffer.path);
  await mkdirAsync(dir, { recursive: true });

  const content = buffer.content.join(buffer.lineEnding);
  if (buffer.content.length > 0 && buffer.lineEnding) {
    await writeFileAsync(buffer.path, content + buffer.lineEnding, 'utf-8');
  } else {
    await writeFileAsync(buffer.path, content, 'utf-8');
  }
  buffer.modified = false;
}

export async function readFileIntoBuffer(
  filename: string,
  buffer: VimBuffer
): Promise<string> {
  const dir = path.dirname(buffer.path);
  const fullPath = path.resolve(dir, filename);

  try {
    const content = await readFileAsync(fullPath, 'utf-8');
    const insertLines = content.split(/\r?\n/);
    if (insertLines.length > 0 && insertLines[insertLines.length - 1] === '') {
      insertLines.pop();
    }

    buffer.content.splice(buffer.currentLine + 1, 0, ...insertLines);
    buffer.modified = true;

    return `${insertLines.length} lines read from ${filename}`;
  } catch (error: any) {
    throw new Error(`Failed to read ${filename}: ${error.message}`);
  }
}

export async function saveAs(
  filename: string,
  buffer: VimBuffer,
  buffers: Map<string, VimBuffer>
): Promise<string> {
  const dir = path.dirname(buffer.path);
  const fullPath = path.resolve(dir, filename);

  await mkdirAsync(path.dirname(fullPath), { recursive: true });
  const content = buffer.content.join(buffer.lineEnding);
  const fullContent = buffer.content.length > 0 && buffer.lineEnding
    ? content + buffer.lineEnding
    : content;
  await writeFileAsync(fullPath, fullContent, 'utf-8');

  buffers.delete(buffer.path);
  buffer.path = fullPath;
  buffer.modified = false;
  buffers.set(fullPath, buffer);

  return `File saved as ${filename}`;
}

export async function externalCommand(
  range: { start: number; end: number } | null,
  args: string | undefined,
  buffer: VimBuffer
): Promise<string> {
  if (!args) {
    throw new Error(':! requires a shell command');
  }

  const targetRange = range || { start: buffer.currentLine, end: buffer.currentLine };
  const linesToFilter = buffer.content.slice(targetRange.start, targetRange.end + 1);
  const tempFile = path.join(os.tmpdir(), `vim_filter_${Date.now()}.tmp`);

  try {
    await fs.promises.writeFile(tempFile, linesToFilter.join('\n'), 'utf-8');

    const execAsync = promisify(exec);
    const cwd = path.dirname(buffer.path);
    const cmd = `cat "${tempFile}" | ${args}`;

    const { stdout } = await execAsync(cmd, { cwd });

    const filteredLines = stdout.split(/\r?\n/);
    if (filteredLines.length > 0 && filteredLines[filteredLines.length - 1] === '') {
      filteredLines.pop();
    }

    buffer.content.splice(targetRange.start, targetRange.end - targetRange.start + 1, ...filteredLines);
    buffer.modified = true;

    return `Filtered ${targetRange.end - targetRange.start + 1} line(s) through: ${args}`;
  } catch (error: any) {
    throw new Error(`Filter command failed: ${error.message}`);
  } finally {
    try {
      await fs.promises.unlink(tempFile);
    } catch {
      // Ignore cleanup errors
    }
  }
}
