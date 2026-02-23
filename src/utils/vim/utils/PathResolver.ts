// src/utils/vim/utils/PathResolver.ts
import * as vscode from "vscode";
import * as path from "path";
import { assertWithinWorkspace } from "../../workspacePath";

export class PathResolver {
  private _workspaceRootProvider: () => string | undefined;
  private _workingDirProvider: () => string | undefined;

  constructor(
    workspaceRootProvider: () => string | undefined,
    workingDirProvider?: () => string | undefined
  ) {
    this._workspaceRootProvider = workspaceRootProvider;
    this._workingDirProvider = workingDirProvider || (() => undefined);
  }

  get workspaceRoot(): string | undefined {
    return this._workspaceRootProvider();
  }

  get workingDir(): string | undefined {
    return this._workingDirProvider();
  }

  setWorkspaceRootProvider(provider: () => string | undefined): void {
    this._workspaceRootProvider = provider;
  }

  setWorkingDirProvider(provider: () => string | undefined): void {
    this._workingDirProvider = provider;
  }

  resolve(filePath: string): string {
    const resolved = this.resolveRaw(filePath);
    const wsRoot = this.workspaceRoot;
    
    // Only enforce workspace boundaries if we have a workspace root
    // AND the path is within the workspace (don't block absolute paths outside workspace)
    if (wsRoot && resolved.startsWith(wsRoot)) {
      assertWithinWorkspace(resolved, wsRoot);
    }
    
    return resolved;
  }

  private resolveRaw(filePath: string): string {
    if (path.isAbsolute(filePath)) {
      return path.resolve(filePath);
    }

    // Priority 1: Use Vim's current working directory if available
    const wd = this.workingDir;
    if (wd) {
      return path.resolve(wd, filePath);
    }

    // Priority 2: Use workspace root
    const wsRoot = this.workspaceRoot;
    if (wsRoot) {
      return path.resolve(wsRoot, filePath);
    }

    // Priority 3: Use active editor's directory
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document && !editor.document.isUntitled) {
      const editorDir = path.dirname(editor.document.fileName);
      return path.resolve(editorDir, filePath);
    }

    throw new Error("Cannot resolve path: no working directory, workspace root, or active editor");
  }
}