import * as vscode from "vscode";
import * as path from "path";
import { assertWithinWorkspace } from "../../workspacePath";

export class PathResolver {
  private _workspaceRootProvider: () => string | undefined;

  constructor(workspaceRootProvider: () => string | undefined) {
    this._workspaceRootProvider = workspaceRootProvider;
  }

  get workspaceRoot(): string | undefined {
    return this._workspaceRootProvider();
  }

  setWorkspaceRootProvider(provider: () => string | undefined): void {
    this._workspaceRootProvider = provider;
  }

  resolve(filePath: string): string {
    const resolved = this.resolveRaw(filePath);
    const wsRoot = this.workspaceRoot;
    if (wsRoot) {
      assertWithinWorkspace(resolved, wsRoot);
    }
    return resolved;
  }

  private resolveRaw(filePath: string): string {
    if (path.isAbsolute(filePath)) {
      return path.resolve(filePath);
    }

    const wsRoot = this.workspaceRoot;
    if (wsRoot) {
      return path.resolve(wsRoot, filePath);
    }

    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document && !editor.document.isUntitled) {
      const editorDir = path.dirname(editor.document.fileName);
      return path.resolve(editorDir, filePath);
    }

    throw new Error("Cannot resolve path: no workspace root or active editor");
  }
}
