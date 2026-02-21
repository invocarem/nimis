import * as path from "path";

function normalizePath(p: string): string {
  const resolved = path.resolve(p);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/**
 * Throws if resolvedPath is outside the workspace root.
 * Comparison is case-insensitive on Windows and handles both
 * forward-slash and back-slash separators.
 */
export function assertWithinWorkspace(
  resolvedPath: string,
  workspaceRoot: string
): void {
  const normalizedPath = normalizePath(resolvedPath);
  const normalizedRoot = normalizePath(workspaceRoot);

  if (
    normalizedPath !== normalizedRoot &&
    !normalizedPath.startsWith(normalizedRoot + path.sep)
  ) {
    throw new Error(
      `Access denied: "${resolvedPath}" is outside workspace "${workspaceRoot}". ` +
        "All file operations must stay within the workspace folder."
    );
  }
}
