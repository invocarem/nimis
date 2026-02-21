import * as vscode from "vscode";
import { NativeToolsManager } from "../utils/nativeToolManager";

// Register a VS Code command to handle native tool calls from LLM or webview
export function registerNativeToolServer(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand(
    "nimis.callNativeTool",
    async (toolName: string, args: Record<string, any>) => {
      return await NativeToolsManager.getInstance().callTool(toolName, args);
    }
  );
  context.subscriptions.push(disposable);
}
