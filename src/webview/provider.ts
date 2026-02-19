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
import * as path from "path";

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

    // If there is an active editor when the view opens, remember that file as initial context
    // (This is just a fallback - working files will be updated when LLM uses tools to access files)
    const active = vscode.window.activeTextEditor;
    if (
      active &&
      active.document &&
      active.document.uri &&
      active.document.uri.fsPath
    ) {
      this.nimisManager
        .getStateTracker()
        .setCurrentFile(active.document.uri.fsPath);
    }

    // Note: We no longer listen for active-editor changes.
    // Working files are now tracked based on tool calls (read_file, find_files, etc.)
    // so the LLM "remembers" which files it has actually accessed.

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

  /**
   * Extracts a file path from a tool call and its result.
   * Updates working files map when tools successfully locate or access files.
   */
  private _extractFilePathFromToolCall(
    toolCall: { name: string; arguments?: Record<string, any> },
    toolResult: { content?: Array<{ type: string; text?: string }>; isError?: boolean }
  ): string | undefined {
    // Only extract file path if tool execution was successful
    if (toolResult.isError) {
      return undefined;
    }

    const toolName = toolCall.name;
    const args = toolCall.arguments || {};

    // For tools that take file_path as argument
    if (
      toolName === "read_file" ||
      toolName === "edit_file" ||
      toolName === "replace_file" ||
      toolName === "create_file"
    ) {
      const filePath = args.file_path || args.filePath;
      if (typeof filePath === "string" && filePath.trim()) {
        // Resolve to absolute path if relative
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (workspaceRoot && !path.isAbsolute(filePath)) {
          return path.resolve(workspaceRoot, filePath);
        }
        return path.isAbsolute(filePath) ? filePath : undefined;
      }
    }

    // For list_files: track the directory that was listed
    if (toolName === "list_files") {
      const directoryPath = args.directory_path || args.directoryPath;
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (directoryPath && typeof directoryPath === "string" && directoryPath.trim()) {
        // Resolve to absolute path if relative
        if (workspaceRoot && !path.isAbsolute(directoryPath)) {
          return path.resolve(workspaceRoot, directoryPath);
        }
        return path.isAbsolute(directoryPath) ? directoryPath : undefined;
      } else if (workspaceRoot) {
        // No directory specified, means workspace root was listed
        return workspaceRoot;
      }
    }

    // For find_files: extract first file path from result text
    if (toolName === "find_files") {
      const resultText = toolResult.content?.map((c) => c.text).join("\n") || "";
      // Result format: "Found N file(s) matching "...":\n\n📄 path/to/file1\n📄 path/to/file2"
      // Extract the first file path after the emoji
      const match = resultText.match(/📄\s+([^\n]+)/);
      if (match && match[1]) {
        const extractedPath = match[1].trim();
        // Resolve to absolute path if relative
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (workspaceRoot && !path.isAbsolute(extractedPath)) {
          return path.resolve(workspaceRoot, extractedPath);
        }
        return path.isAbsolute(extractedPath) ? extractedPath : undefined;
      }
    }

    return undefined;
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

              // Diagnostic logging: Check if edit_file tool call appears in streaming response
              if (parsed.tool_calls) {
                for (const toolCall of parsed.tool_calls) {
                  if (toolCall.name === "edit_file" && toolCall.arguments?.old_text) {
                    console.log("[Provider] [STREAMING] edit_file detected in chunk, old_text length:",
                      toolCall.arguments.old_text.length);
                  }
                }
              }
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
          if (
            this.cancellationToken?.signal.aborted ||
            streamError.name === "CanceledError" ||
            streamError.name === "AbortError"
          ) {
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

        const parsedResponse: ParsedResponse =
          ResponseParser.parse(fullResponse);

        // Diagnostic logging for edit_file old_text mismatch issues
        if (ResponseParser.hasToolCalls(parsedResponse)) {
          const toolCalls = ResponseParser.getAllToolCalls(parsedResponse);

          // Log raw response and extracted tool calls for debugging
          for (const toolCall of toolCalls) {
            if (toolCall.name === "edit_file" && toolCall.arguments?.old_text) {
              const oldText = toolCall.arguments.old_text;
              console.log("[Provider] edit_file tool call detected:");
              console.log("[Provider]   Raw fullResponse length:", fullResponse.length);
              console.log("[Provider]   Raw fullResponse (first 500 chars):", fullResponse.substring(0, 500));
              console.log("[Provider]   Extracted old_text length:", oldText.length);
              console.log("[Provider]   Extracted old_text (JSON):", JSON.stringify(oldText));
              console.log("[Provider]   Extracted old_text (visible whitespace):",
                oldText.replace(/\n/g, "\\n").replace(/\t/g, "\\t").replace(/ /g, "·"));
              console.log("[Provider]   Extracted new_text (JSON):", JSON.stringify(toolCall.arguments.new_text));
            }
          }
          let allToolResults: string[] = [];
          let hasError = false;

          // Execute all tool calls sequentially
          for (const toolCall of toolCalls) {
            // Check for cancellation before each tool execution
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
              hasError = true;
              break;
            }

            this._sendMessageToWebview({
              type: "assistantMessageChunk",
              chunk: `Executing tool: ${toolCall.name}...`,
              isFullContent: false,
            });

            try {
              stateTracker.recordToolCall(toolCall.name, toolCall.arguments);
              const toolResult = await toolExecutor(toolCall, {
                mcpManager: this.mcpManager,
              });

              // Check for cancellation after tool execution
              if (this.cancellationToken?.signal.aborted) {
                continueLoop = false;
                break;
              }

              const toolText =
                toolResult.content?.map((c) => c.text).join("\n") ||
                JSON.stringify(toolResult);
              allToolResults.push(toolText);

              // Extract file path from tool call and result, and update working files
              // This tracks when the LLM successfully locates or accesses files via tools
              try {
                const filePath = this._extractFilePathFromToolCall(
                  toolCall,
                  toolResult
                );
                if (filePath) {
                  console.debug(
                    "[Provider] Extracted file path from tool call:",
                    toolCall.name,
                    "->",
                    filePath
                  );
                  stateTracker.setCurrentFile(filePath);
                } else {
                  console.debug(
                    "[Provider] No file path extracted from tool call:",
                    toolCall.name,
                    "args:",
                    toolCall.arguments,
                    "isError:",
                    toolResult.isError
                  );
                }
              } catch (e) {
                // ignore errors in file path extraction
                console.debug(
                  "[Provider] Error extracting file path from tool call:",
                  e
                );
              }

              this._sendMessageToWebview({
                type: "assistantMessageChunk",
                chunk: toolText,
                isFullContent: true,
              });

              // If tool execution failed, stop processing remaining tool calls
              if (toolResult.isError) {
                hasError = true;
                break;
              }
            } catch (err: any) {
              const errorText = `Tool execution error: ${err.message}`;
              allToolResults.push(errorText);
              this._sendMessageToWebview({
                type: "assistantMessageChunk",
                chunk: errorText,
                isFullContent: true,
              });
              hasError = true;
              break;
            }
          }

          // Add assistant message and tool results to conversation history
          // Include tool results even when there's an error so the AI can see and respond to errors
          if (
            !this.cancellationToken?.signal.aborted &&
            allToolResults.length > 0
          ) {
            this.conversationHistory.push({
              role: "assistant",
              content: parsedResponse.raw,
            });
            this.conversationHistory.push({
              role: "user",
              content: allToolResults.join("\n\n"),
            });
            // Continue loop to get next LLM response (even if there was an error)
            // This allows the AI to see the error and potentially fix it
            continue;
          } else {
            // If there was a cancellation or no tool results, stop the loop
            continueLoop = false;
          }
        } else {
          // No tool calls, add final response and exit
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
          message:
            "Operation cancelled. Please provide feedback to guide the assistant.",
        });
      } else {
        this._sendMessageToWebview({
          type: "assistantMessageEnd",
        });
      }
    } catch (error: any) {
      // Don't show error if it was a cancellation
      if (
        !this.cancellationToken?.signal.aborted &&
        error.name !== "CanceledError" &&
        error.name !== "AbortError"
      ) {
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
        "dist",
        "webview",
        "assets",
        "styles.css"
      )
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._extensionUri,
        "dist",
        "webview",
        "assets",
        "main.js"
      )
    );
    const formatterScriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._extensionUri,
        "dist",
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
            <button id="stop-button" class="stop-button secondary-button" style="display: none;">Stop</button>
            <button id="clear-button" class="secondary-button">Clear Chat</button>
        </div>
    </div>
    <script nonce="${nonce}" src="${formatterScriptUri}"></script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
