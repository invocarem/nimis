import * as vscode from "vscode";
import { LlamaClient } from "../api/llamaClient";
import { getNonce } from "../utils/getNonce";
import { NimisManager } from "../utils/nimisManager";
import { toolExecutor } from "../toolExecutor";
import { ResponseParser, ParsedResponse } from "../utils/responseParser";
import { TOOL_CALL_LIMIT_PER_TURN } from "../utils/nimisStateTracker";
import type { MCPManager } from "../mcpManager";
import type { RulesManager } from "../rulesManager";

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

export class NimisViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "nimis.chatView";
  private _view?: vscode.WebviewView;
  private llamaClient?: LlamaClient;
  private conversationHistory: Message[] = [];
  private nimisManager: NimisManager;
  private mcpManager?: MCPManager;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    mcpManager?: MCPManager,
    rulesManager?: RulesManager
  ) {
    this.mcpManager = mcpManager;
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    this.nimisManager = new NimisManager({
      mcpManager,
      rulesManager,
      workspaceRoot,
    });
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext, // eslint-disable-line @typescript-eslint/no-unused-vars
    _token: vscode.CancellationToken // eslint-disable-line @typescript-eslint/no-unused-vars
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Initialize the llama client
    this._initializeLlamaClient();

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case "sendMessage":
          await this._handleUserMessage(data.message);
          break;
        case "insertCode":
          await vscode.commands.executeCommand("nimis.insertCode", data.code);
          break;
        case "clearChat":
          this.conversationHistory = [];
          this.nimisManager.getStateTracker().reset();
          break;
        case "checkConnection":
          await this._checkConnection();
          break;
      }
    });

    // Listen for configuration changes
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("nimis.llamaServerUrl")) {
        this._initializeLlamaClient();
      }
    });
  }

  private _initializeLlamaClient() {
    const config = vscode.workspace.getConfiguration("nimis");
    const serverUrl = config.get<string>(
      "llamaServerUrl",
      "http://localhost:8080"
    );
    this.llamaClient = new LlamaClient(serverUrl);
  }

  private async _checkConnection() {
    if (!this.llamaClient) {
      this._sendMessageToWebview({
        type: "connectionStatus",
        connected: false,
        error: "Client not initialized",
      });
      return;
    }

    try {
      const connected = await this.llamaClient.healthCheck();
      this._sendMessageToWebview({
        type: "connectionStatus",
        connected,
      });
    } catch (error) {
      this._sendMessageToWebview({
        type: "connectionStatus",
        connected: false,
        error:
          error instanceof Error ? error.message : "Connection check failed",
      });
    }
  }

  private async _handleUserMessage(userMessage: string) {
    if (!this.llamaClient) {
      this._sendMessageToWebview({
        type: "error",
        message: "Llama client not initialized",
      });
      return;
    }

    const stateTracker = this.nimisManager.getStateTracker();
    if (this.conversationHistory.length === 0) {
      stateTracker.setProblem(userMessage);
    } else {
      stateTracker.recordFeedback(userMessage);
    }

    this.conversationHistory.push({
      role: "user",
      content: userMessage,
    });

    this._sendMessageToWebview({
      type: "userMessage",
      message: userMessage,
    });

    this._sendMessageToWebview({
      type: "assistantMessageStart",
    });

    try {
      const config = vscode.workspace.getConfiguration("nimis");
      const temperature = config.get<number>("temperature", 0.7);
      const maxTokens = config.get<number>("maxTokens", 2048);

      let continueLoop = true;
      let lastToolResult: string | undefined = undefined;
      let isFirst = true;

      stateTracker.startNewTurn();

      while (continueLoop) {
        const prompt = this.nimisManager.buildConversationPrompt(
          this.conversationHistory
        );

        let fullResponse = "";

        await this.llamaClient.streamComplete(
          {
            prompt,
            temperature,
            n_predict: maxTokens,
            stop: ["User:", "\nUser:", "Human:", "\nHuman:"],
          },
          (chunk: string) => {
            fullResponse += chunk;
            const parsed = ResponseParser.parse(fullResponse);
            this._sendMessageToWebview({
              type: "assistantMessageChunk",
              chunk: parsed.content,
              isFullContent: true,
            });
          }
        );

        const parsedResponse: ParsedResponse = ResponseParser.parse(fullResponse);

        if (ResponseParser.hasToolCalls(parsedResponse)) {
          const firstToolCall = ResponseParser.getFirstToolCall(parsedResponse);

          if (firstToolCall) {
            if (stateTracker.hasReachedToolCallLimit()) {
              this._sendMessageToWebview({
                type: "requestFeedback",
                message: `Tool call limit (${TOOL_CALL_LIMIT_PER_TURN}) reached this turn. Add feedback below to guide the assistant.`,
              });
              continueLoop = false;
              break;
            }
            this._sendMessageToWebview({
              type: "assistantMessageChunk",
              chunk: `Executing tool: ${firstToolCall.name}...`,
              isFullContent: false,
            });
            try {
              stateTracker.recordToolCall(firstToolCall.name, firstToolCall.arguments);
              const toolResult = await toolExecutor(firstToolCall, {
                mcpManager: this.mcpManager,
              });
              const toolText = toolResult.content?.map(c => c.text).join("\n") || JSON.stringify(toolResult);
              this._sendMessageToWebview({
                type: "assistantMessageChunk",
                chunk: toolText,
                isFullContent: true,
              });
              this.conversationHistory.push({
                role: "assistant",
                content: parsedResponse.raw,
              });
              this.conversationHistory.push({
                role: "user",
                content: toolText,
              });
              isFirst = false;
              continue;
            } catch (err: any) {
              this._sendMessageToWebview({
                type: "assistantMessageChunk",
                chunk: `Tool execution error: ${err.message}`,
                isFullContent: true,
              });
              continueLoop = false;
              break;
            }
          }
        } else {
          this.conversationHistory.push({
            role: "assistant",
            content: parsedResponse.raw,
          });
          continueLoop = false;
        }
      }

      this._sendMessageToWebview({
        type: "assistantMessageEnd",
      });
    } catch (error: any) {
      this._sendMessageToWebview({
        type: "error",
        message: error.message,
      });
    }
  }

  public explainCode(code: string) {
    const message = this.nimisManager.buildExplanationPrompt(code);

    if (this._view) {
      this._sendMessageToWebview({
        type: "setInput",
        message,
      });
    }
  }

  private _sendMessageToWebview(message: any) {
    if (this._view) {
      this._view.webview.postMessage(message);
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = getNonce();

    // Get URIs for CSS and JS files
    const stylesUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._extensionUri,
        "src",
        "webview",
        "assets",
        "styles.css"
      )
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._extensionUri,
        "src",
        "webview",
        "assets",
        "main.js"
      )
    );
    const formatterScriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._extensionUri,
        "src",
        "webview",
        "assets",
        "markdownFormatter.js"
      )
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
    <title>Nimis AI</title>
    <link rel="stylesheet" href="${stylesUri}">
</head>
<body>
    <div id="chat-container"></div>
    <div id="input-container">
        <div class="status-indicator" id="status-indicator">Checking connection...</div>
        <textarea id="message-input" placeholder="Type your message here..." rows="3"></textarea>
        <div class="button-group">
            <button id="send-button">Send</button>
            <button id="clear-button" class="secondary-button">Clear Chat</button>
        </div>
    </div>
    <script nonce="${nonce}" src="${formatterScriptUri}"></script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
