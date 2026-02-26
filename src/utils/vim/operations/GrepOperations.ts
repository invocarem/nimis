import * as fs from "fs";
import * as path from "path";

const EXCLUDED_FOLDERS = new Set([
  "node_modules",
  ".git",
  ".venv",
  "venv",
  ".env",
  "__pycache__",
  ".pytest_cache",
  "dist",
  "build",
  ".next",
  ".nuxt",
  "coverage",
  ".coverage",
]);

function shouldExcludeFolder(folderName: string, relativePath: string): boolean {
  if (EXCLUDED_FOLDERS.has(folderName)) return true;
  const segments = relativePath.split(path.sep);
  return segments.some((s) => EXCLUDED_FOLDERS.has(s));
}

function matchesGlob(filename: string, pattern: string): boolean {
  let regexStr = pattern
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, "___DS___")
    .replace(/\*/g, "[^/]*")
    .replace(/___DS___/g, ".*");
  return new RegExp(`^${regexStr}$`).test(filename);
}

async function collectFiles(
  dir: string,
  files: string[],
  filePattern?: string,
  limit: number = 5000
): Promise<void> {
  if (files.length >= limit) return;
  try {
    const entries = await fs.promises.readdir(dir);
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      const entryPath = path.join(dir, entry);
      const relativePath = path.relative(dir, entryPath);
      const stats = await fs.promises.stat(entryPath);
      if (stats.isDirectory()) {
        if (shouldExcludeFolder(entry, relativePath)) continue;
        await collectFiles(entryPath, files, filePattern, limit);
      } else if (stats.isFile()) {
        if (filePattern && !matchesGlob(entry, filePattern)) continue;
        files.push(entryPath);
      }
    }
  } catch (e) {
    // Skip dirs we can't read
  }
}

export interface GrepResult {
  file: string;
  line: number;
  content: string;
}

export async function grepInDirectory(
  pattern: string,
  directory: string,
  filePattern?: string,
  caseSensitive: boolean = false
): Promise<{ text: string; isError: boolean }> {
  try {
    new RegExp(pattern);
  } catch (err: any) {
    return {
      text: `Error: Invalid regex pattern "${pattern}": ${err.message}`,
      isError: true,
    };
  }

  const files: string[] = [];
  await collectFiles(directory, files, filePattern);

  const results: GrepResult[] = [];
  const regex = new RegExp(pattern, caseSensitive ? "" : "i");

  for (const file of files) {
    try {
      const content = await fs.promises.readFile(file, "utf-8");
      const lines = content.split("\n");
      const relativePath = path.relative(directory, file);
      lines.forEach((line, i) => {
        if (regex.test(line)) {
          results.push({ file: relativePath, line: i + 1, content: line.trim() });
        }
      });
    } catch {
      // Skip unreadable files
    }
  }

  if (results.length === 0) {
    return { text: `No matches found for pattern "${pattern}"`, isError: false };
  }

  const formatted = results
    .map((r) => `${r.file}:${r.line}: ${r.content}`)
    .join("\n");
  return { text: formatted, isError: false };
}
