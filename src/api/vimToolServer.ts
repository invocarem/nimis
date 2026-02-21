import * as vscode from "vscode";
import { VimToolManager } from "../utils/vim";

export function registerVimToolServer(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand(
    "nimis.callVimTool",
    async (toolName: string, args: Record<string, any>) => {
      return await VimToolManager.getInstance().callTool(toolName, args);
    }
  );
  context.subscriptions.push(disposable);
}
