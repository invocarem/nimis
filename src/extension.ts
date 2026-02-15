import * as vscode from "vscode";

import { NimisViewProvider } from "./webview/provider";
import { registerNativeToolServer } from "./api/nativeToolServer";
import { registerRuleServer } from "./api/ruleServer";
import { MCPManager } from "./mcpManager";
import { MCPToolServer } from "./api/mcpToolServer";

export function activate(context: vscode.ExtensionContext) {
  console.log("Nimis extension is now active");

  // Register native tool server (for LLM/native tool integration)
  registerNativeToolServer(context);
  // Register rule server (for rule management) and get RulesManager for prompts
  const ruleServer = registerRuleServer(context);
  const rulesManager = ruleServer.getRulesManager();

  // Create MCP manager and initialize servers (may connect to 0 or more MCP servers)
  const mcpManager = new MCPManager();
  const mcpServers = vscode.workspace.getConfiguration('nimis').get('mcpServers') as any[];
  if (mcpServers && mcpServers.length > 0) {
    mcpManager.initializeServers(mcpServers).then(() => {
      console.log("MCP servers initialized from settings.");
    });
  } else {
    console.log("No MCP servers configured in settings.");
  }
  context.subscriptions.push({ dispose: () => mcpManager.dispose() });

  // Register the webview provider for the sidebar (pass mcpManager and rulesManager for prompts)
  const provider = new NimisViewProvider(context.extensionUri, mcpManager, rulesManager);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("nimis.chatView", provider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    })
  );

  // Register commands
  const openChatCommand = vscode.commands.registerCommand(
    "nimis.openChat",
    () => {
      vscode.commands.executeCommand("nimis.chatView.focus");
    }
  );

  const insertCodeCommand = vscode.commands.registerCommand(
    "nimis.insertCode",
    async (code: string) => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        await editor.edit((editBuilder) => {
          editBuilder.insert(editor.selection.active, code);
        });
      }
    }
  );

  const explainCodeCommand = vscode.commands.registerCommand(
    "nimis.explainCode",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage("No active editor");
        return;
      }

      const selection = editor.selection;
      const selectedText = editor.document.getText(selection);

      if (!selectedText) {
        vscode.window.showInformationMessage("No code selected");
        return;
      }

      // Focus the chat view and send the code for explanation
      await vscode.commands.executeCommand("nimis.chatView.focus");
      provider.explainCode(selectedText);
    }
  );

  context.subscriptions.push(
    openChatCommand,
    insertCodeCommand,
    explainCodeCommand
  );
}

export function deactivate() {}
