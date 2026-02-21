import * as vscode from "vscode";
import { ILLMClient, CompletionRequest } from "../api/llmClient";
import { LlamaClient } from "../api/llamaClient";
import { VLLMClient } from "../api/vllmClient";
import { getNonce } from "../utils/getNonce";
import { NimisManager } from "../utils/nimisManager";
import { toolExecutor } from "../toolExecutor";
import { ResponseParser, ParsedResponse } from "../utils/responseParser";
import { TOOL_CALL_LIMIT_PER_TURN } from "../utils/nimisStateTracker";
import type { MCPManager } from "../mcpManager";
import type { RulesManager } from "../rulesManager";
import * as path from "path";
import { NativeToolsManager } from "../utils/nativeToolManager";
import { VimToolManager } from "../utils/vim";

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

export class NimisViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "nimis.chatView";
  private _view?: vscode.WebviewView;
  private llmClient?: ILLMClient;
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
      vimToolManager: VimToolManager.getInstance(),
      rulesManager,
      workspaceRoot,
    });
    const stateTracker = this.nimisManager.getStateTracker();
    NativeToolsManager.getInstance().setWorkspaceRootProvider(
      () => stateTracker.getWorkspaceRoot()
    );
    VimToolManager.getInstance().setWorkspaceRootProvider(
      () => stateTracker.getWorkspaceRoot()
    );
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

    // Initialize the LLM client
    this._initializeLLMClient();

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
      if (
        e.affectsConfiguration("nimis.serverUrl") ||
        e.affectsConfiguration("nimis.llamaServerUrl") ||
        e.affectsConfiguration("nimis.serverType") ||
        e.affectsConfiguration("nimis.model")
      ) {
        this._initializeLLMClient();
      }
    });
  }

  private _initializeLLMClient() {
    const config = vscode.workspace.getConfiguration("nimis");
    const serverType = config.get<string>("serverType", "llama");
    const defaultUrl =
      serverType === "vllm" ? "http://localhost:8000" : "http://localhost:8080";
    const serverUrl =
      config.get<string>("serverUrl") ||
      config.get<string>("llamaServerUrl") ||
      defaultUrl;

    if (serverType === "vllm") {
      const model = config.get<string>("model", "default");
      this.llmClient = new VLLMClient(serverUrl, model);
    } else {
      this.llmClient = new LlamaClient(serverUrl);
    }
  }

  private async _checkConnection() {
    if (!this.llmClient) {
      this._sendMessageToWebview({
        type: "connectionStatus",
        connected: false,
        error: "Client not initialized",
      });
      return;
    }

    try {
      const connected = await this.llmClient.healthCheck();
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
    toolResult: {
      content?: Array<{ type: string; text?: string }>;
      isError?: boolean;
    }
  ): string | undefined {
    // Only extract file path if tool execution was successful
    if (toolResult.isError) {
      return undefined;
    }

    const toolName = toolCall.name;
    const args = toolCall.arguments || {};

    const workspaceRoot = this.nimisManager.getStateTracker().getWorkspaceRoot();

    if (
      toolName === "read_file" ||
      toolName === "edit_file" ||
      toolName === "edit_lines" ||
      toolName === "replace_file" ||
      toolName === "create_file"
    ) {
      const filePath = args.file_path || args.filePath;
      if (typeof filePath === "string" && filePath.trim()) {
        if (workspaceRoot && !path.isAbsolute(filePath)) {
          return path.resolve(workspaceRoot, filePath);
        }
        return path.isAbsolute(filePath) ? filePath : undefined;
      }
    }

    if (toolName === "list_files") {
      const directoryPath = args.directory_path || args.directoryPath;
      if (
        directoryPath &&
        typeof directoryPath === "string" &&
        directoryPath.trim()
      ) {
        if (workspaceRoot && !path.isAbsolute(directoryPath)) {
          return path.resolve(workspaceRoot, directoryPath);
        }
        return path.isAbsolute(directoryPath) ? directoryPath : undefined;
      } else if (workspaceRoot) {
        return workspaceRoot;
      }
    }

    if (toolName === "find_files") {
      const resultText =
        toolResult.content?.map((c) => c.text).join("\n") || "";
      const match = resultText.match(/📄\s+([^\n]+)/);
      if (match && match[1]) {
        const extractedPath = match[1].trim();
        if (workspaceRoot && !path.isAbsolute(extractedPath)) {
          return path.resolve(workspaceRoot, extractedPath);
        }
        return path.isAbsolute(extractedPath) ? extractedPath : undefined;
      }
    }

    return undefined;
  }

  private async _handleUserMessage(userMessage: string) {
    if (!this.llmClient) {
      this._sendMessageToWebview({
        type: "error",
        message: "LLM client not initialized",
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
          await this.llmClient.streamComplete(
            {
              prompt,
              temperature,
              maxTokens,
              stop: ["User:", "\nUser:", "Human:", "\nHuman:"],
            },
            (chunk: string) => {
              // Check for cancellation between chunks
              if (this.cancellationToken?.signal.aborted) {
                return;
              }
              fullResponse += chunk;
              const parsed = ResponseParser.parse(fullResponse);

              // Diagnostic logging: Check if edit_file tool call appears in streaming response
              if (parsed.tool_calls) {
                for (const toolCall of parsed.tool_calls) {
                  if (
                    toolCall.name === "edit_file" &&
                    toolCall.arguments?.old_text
                  ) {
                    console.log(
                      "[Provider] [STREAMING] edit_file detected in chunk, old_text length:",
                      toolCall.arguments.old_text.length
                    );
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
        console.debug("[Provider] content:", parsedResponse.content);

        // Diagnostic logging for edit_file old_text mismatch issues
        if (ResponseParser.hasToolCalls(parsedResponse)) {
          const toolCalls = ResponseParser.getAllToolCalls(parsedResponse);

          // Log raw response and extracted tool calls for debugging
          for (const toolCall of toolCalls) {
            if (toolCall.name === "edit_file" && toolCall.arguments?.old_text) {
              const oldText = toolCall.arguments.old_text;
              console.log("[Provider] edit_file tool call detected:");
              console.log(
                "[Provider]   Raw fullResponse length:",
                fullResponse.length
              );
              console.log(
                "[Provider]   Raw fullResponse (first 500 chars):",
                fullResponse.substring(0, 500)
              );
              console.log(
                "[Provider]   Extracted old_text length:",
                oldText.length
              );
              console.log(
                "[Provider]   Extracted old_text (JSON):",
                JSON.stringify(oldText)
              );
              console.log(
                "[Provider]   Extracted old_text (visible whitespace):",
                oldText
                  .replace(/\n/g, "\\n")
                  .replace(/\t/g, "\\t")
                  .replace(/ /g, "·")
              );
              console.log(
                "[Provider]   Extracted new_text (JSON):",
                JSON.stringify(toolCall.arguments.new_text)
              );
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

            // Record tool call before execution (for counting/limit checking)
            stateTracker.recordToolCall(toolCall.name, toolCall.arguments);

            try {
              const toolResult = await toolExecutor(toolCall, {
                mcpManager: this.mcpManager,
                vimToolManager: VimToolManager.getInstance(),
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

              // Update the last tool call with result information
              const resultSummary =
                toolText.length > 200
                  ? toolText.substring(0, 200) + "..."
                  : toolText;
              stateTracker.updateLastToolCallResult({
                success: !toolResult.isError,
                summary: resultSummary || undefined,
              });

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

              // Update the last tool call with error result
              stateTracker.updateLastToolCallResult({
                success: false,
                summary: errorText,
              });

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
