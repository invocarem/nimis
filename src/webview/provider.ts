import * as vscode from "vscode";
import { LlamaClient } from "../api/llamaClient";
import { getNonce } from "../utils/getNonce";
import { NimisManager } from "../utils/nimisManager";
import { toolExecutor } from "../toolExecutor";
import { ResponseParser, ParsedResponse } from "../utils/responseParser";
import { TOOL_CALL_LIMIT_PER_TURN } from "../utils/nimisStateTracker";
import type { MCPManager } from "../mcpManager";
import type { RulesManager } from "../rulesManager";
import { parse } from "path";

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
  private cancellationToken?: AbortController;
  private isProcessing = false;

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
        case "cancelRequest":
          this._cancelCurrentOperation();
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

    // Cancel any existing operation
    if (this.isProcessing) {
      this._cancelCurrentOperation();
    }

    // Create new cancellation token
    this.cancellationToken = new AbortController();
    this.isProcessing = true;

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

      while (continueLoop && !this.cancellationToken.signal.aborted) {
        const prompt = this.nimisManager.buildConversationPrompt(
          this.conversationHistory
        );

        let fullResponse = "";

        try {
          await this.llamaClient.streamComplete(
            {
              prompt,
              temperature,
              n_predict: maxTokens,
              stop: ["User:", "\nUser:", "Human:", "\nHuman:"],
            },
            (chunk: string) => {
              // Check for cancellation between chunks
              if (this.cancellationToken?.signal.aborted) {
                return;
              }
              fullResponse += chunk;
              //console.debug("[Provider] received:", chunk); // Log each chunk to DEBUG console
              const parsed = ResponseParser.parse(fullResponse);
              console.debug("[Provider] content:", parsed.content);
              this._sendMessageToWebview({
                type: "assistantMessageChunk",
                chunk: parsed.content,
                isFullContent: true,
              });
            },
            this.cancellationToken?.signal
          );
        } catch (streamError: any) {
          // If cancelled, break out of loop
          if (this.cancellationToken?.signal.aborted || streamError.name === "CanceledError" || streamError.name === "AbortError") {
            continueLoop = false;
            break;
          }
          throw streamError;
        }

        // Check for cancellation after streaming
        if (this.cancellationToken?.signal.aborted) {
          continueLoop = false;
          break;
        }

        const parsedResponse: ParsedResponse = ResponseParser.parse(fullResponse);

        if (ResponseParser.hasToolCalls(parsedResponse)) {
          const firstToolCall = ResponseParser.getFirstToolCall(parsedResponse);

          if (firstToolCall) {
            // Check for cancellation before tool execution
            if (this.cancellationToken?.signal.aborted) {
              continueLoop = false;
              break;
            }

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

              // Check for cancellation after tool execution
              if (this.cancellationToken?.signal.aborted) {
                continueLoop = false;
                break;
              }

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

      // Check if operation was cancelled
      if (this.cancellationToken?.signal.aborted) {
        this._sendMessageToWebview({
          type: "cancellationComplete",
        });
        this._sendMessageToWebview({
          type: "requestFeedback",
          message: "Operation cancelled. Please provide feedback to guide the assistant.",
        });
      } else {
        this._sendMessageToWebview({
          type: "assistantMessageEnd",
        });
      }
    } catch (error: any) {
      // Don't show error if it was a cancellation
      if (!this.cancellationToken?.signal.aborted && error.name !== "CanceledError" && error.name !== "AbortError") {
        this._sendMessageToWebview({
          type: "error",
          message: error.message,
        });
      } else {
        this._sendMessageToWebview({
          type: "cancellationComplete",
        });
      }
    } finally {
      this.isProcessing = false;
      this.cancellationToken = undefined;
    }
  }

  private _cancelCurrentOperation() {
    if (this.isProcessing && this.cancellationToken) {
      this._sendMessageToWebview({
        type: "cancellationInProgress",
      });
      this.cancellationToken.abort();
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
        <textarea id="message-input" placeholder="Type your message here..." rows="3"></textarea>
        <div class="button-group">
            <button id="send-button">Send</button>
            <button id="stop-button" class="stop-button secondary-button" style="display: none;">Stop</button>
            <button id="clear-button" class="secondary-button">Clear Chat</button>
            <div class="status-lamp" id="status-lamp" title="Checking connection..."></div>
        </div>
    </div>
    <script nonce="${nonce}" src="${formatterScriptUri}"></script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
