import * as vscode from "vscode";
import { ILLMClient, CompletionRequest } from "../api/llmClient";
import { LlamaClient } from "../api/llamaClient";
import { VLLMClient } from "../api/vllmClient";
import { MistralClient } from "../api/mistralClient";
import { getNonce } from "../utils/getNonce";
import { NimisManager } from "../utils/nimisManager";
import { toolExecutor } from "../toolExecutor";
import { ResponseParser, ParsedResponse } from "../utils/responseParser";
import {
  looksLikeToolCallXml,
  validateToolCallXml,
} from "../utils/ToolCallXmlValidator";
import { TOOL_CALL_LIMIT_PER_TURN } from "../utils/nimisStateTracker";
import type { MCPManager } from "../mcpManager";
import type { RulesManager } from "../rulesManager";
import * as path from "path";
import { NativeToolsManager } from "../utils/nativeToolManager";
import { VimToolManager } from "../utils/vim";
import { loadBenchConfig } from "../utils/bench";

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
  private _benchCancelHandler?: () => void;
  private _stepModeContinueResolve?: () => void;

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
    NativeToolsManager.getInstance().setWorkspaceRootProvider(() =>
      stateTracker.getWorkspaceRoot()
    );
    VimToolManager.getInstance().setWorkspaceRootProvider(() =>
      stateTracker.getWorkspaceRoot()
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
          this._sendMessageToWebview({ type: "vimState", state: null });
          // Cancel any in-progress operation (e.g. step mode pause) so we exit cleanly
          this._cancelCurrentOperation();
          break;
        case "checkConnection":
          await this._checkConnection();
          break;
        case "cancelRequest":
          this._cancelCurrentOperation();
          break;
        case "vimCommand":
          await this._handleVimCommand(data.command);
          break;
        case "vimNavRequest":
          await this._handleVimNavRequest(data.command);
          break;
        case "requestVimState":
          this._sendVimStateToWebview();
          break;
        case "runBench":
          vscode.commands.executeCommand("nimis.runBench");
          break;
        case "runBenchSelected":
          vscode.commands.executeCommand("nimis.runBenchSelected", data.testIds || []);
          break;
        case "requestBenchConfig": {
          const loaded = loadBenchConfig();
          const tests = loaded?.config.tests.map((t) => ({ id: t.id, promptPath: t.promptPath })) ?? [];
          this._sendMessageToWebview({ type: "benchConfig", tests });
          break;
        }
        case "cancelBench":
          this._benchCancelHandler?.();
          break;
        case "loadCurrentFileIntoVim":
          await this._loadCurrentFileIntoVim();
          break;
        case "saveCurrentFile":
          await this._saveCurrentFile();
          break;
        case "stepContinue":
          if (this._stepModeContinueResolve) {
            this._stepModeContinueResolve();
            this._stepModeContinueResolve = undefined;
          }
          break;
        case "toggleStepMode": {
          const config = vscode.workspace.getConfiguration("nimis");
          const current = config.get<boolean>("stepMode", false);
          const next = !current;
          await config.update("stepMode", next, vscode.ConfigurationTarget.Global);
          this._sendMessageToWebview({ type: "stepModeState", stepMode: next });
          break;
        }
      }
    });

    // Listen for configuration changes
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration("nimis.serverUrl") ||
        e.affectsConfiguration("nimis.llamaServerUrl") ||
        e.affectsConfiguration("nimis.serverType") ||
        e.affectsConfiguration("nimis.model") ||
        e.affectsConfiguration("nimis.apiKey")
      ) {
        this._initializeLLMClient();
      }
    });
  }

  private _initializeLLMClient() {
    const config = vscode.workspace.getConfiguration("nimis");
    const serverType = config.get<string>("serverType", "llama");

    if (serverType === "mistral") {
      const apiKey = config.get<string>("apiKey", "");
      const model = config.get<string>("model", "mistral-medium-2508");
      if (!apiKey) {
        console.warn("[Nimis] Mistral selected but nimis.apiKey is not set.");
      }
      this.llmClient = new MistralClient(apiKey, model);
    } else {
      const defaultUrl =
        serverType === "vllm"
          ? "http://localhost:8000"
          : "http://localhost:8080";
      const serverUrl =
        config.get<string>("serverUrl") ||
        defaultUrl;

      if (serverType === "vllm") {
        const model = config.get<string>("model", "default");
        this.llmClient = new VLLMClient(serverUrl, model);
      } else {
        this.llmClient = new LlamaClient(serverUrl);
      }
    }
  }

  private async _checkConnection() {
    const config = vscode.workspace.getConfiguration("nimis");
    const stepMode = config.get<boolean>("stepMode", false);

    if (!this.llmClient) {
      this._sendMessageToWebview({
        type: "connectionStatus",
        connected: false,
        error: "Client not initialized",
        stepMode,
      });
      return;
    }

    try {
      const connected = await this.llmClient.healthCheck();
      this._sendMessageToWebview({
        type: "connectionStatus",
        connected,
        stepMode,
      });
    } catch (error) {
      this._sendMessageToWebview({
        type: "connectionStatus",
        connected: false,
        error:
          error instanceof Error ? error.message : "Connection check failed",
        stepMode,
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

    const workspaceRoot = this.nimisManager
      .getStateTracker()
      .getWorkspaceRoot();

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
      const stepMode = config.get<boolean>("stepMode", false);
      console.log("[Provider] temperature:", temperature);
      console.log("[Provider] maxTokens:", maxTokens);
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
              //console.debug("[Provider] stream:", parsed.content);

              // Diagnostic logging: Check if edit_file or vim tool call appears in streaming response
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
                  if (toolCall.name === "vim") {
                    console.log(
                      "[Provider] [STREAMING] vim detected in chunk:",
                      JSON.stringify(toolCall.arguments)
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

        console.debug("[Provider] raw fullResponse:", fullResponse);
        const parsedResponse: ParsedResponse =
          ResponseParser.parse(fullResponse);
        //console.debug("[Provider] content:", parsedResponse.content);

        // Validate XML structure when response contains <tool_call> blocks
        // Feed validation errors back to LLM (like VimToolCallValidator) so it can correct itself
        if (looksLikeToolCallXml(fullResponse)) {
          const xmlValidation = validateToolCallXml(fullResponse);
          if (!xmlValidation.valid && xmlValidation.errors.length > 0) {
            console.warn(
              "[Provider] Tool call XML validation failed (feedback sent to LLM):",
              xmlValidation.errors
            );
            const feedback =
              `Tool call XML validation failed:\n${xmlValidation.errors.map((e) => `  - ${e}`).join("\n")}`;
            this.conversationHistory.push({
              role: "assistant",
              content: parsedResponse.raw,
            });
            this.conversationHistory.push({
              role: "user",
              content: feedback,
            });
            this._sendMessageToWebview({
              type: "assistantMessageChunk",
              chunk: feedback,
              isFullContent: true,
            });
            continue;
          }
        }

        // Diagnostic: response looks like tool call XML but extractor returned 0
        if (
          looksLikeToolCallXml(fullResponse) &&
          !ResponseParser.hasToolCalls(parsedResponse)
        ) {
          console.warn(
            "[Provider] Tool call XML detected during streaming but extractor returned 0 tool calls. " +
              "Response may be truncated or malformed. Length:",
            fullResponse.length,
            "First 600 chars:",
            fullResponse.substring(0, 600)
          );
        }

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
            if (toolCall.name === "vim") {
              console.log("[Provider] vim tool call detected:");
              console.log(
                "[Provider]   Raw fullResponse length:",
                fullResponse.length
              );
              console.log(
                "[Provider]   Extracted vim arguments:",
                JSON.stringify(toolCall.arguments, null, 2)
              );
              const rawToolCall = fullResponse.match(
                /<tool_call\s+name=["']vim["'][^>]*>[\s\S]*?<\/tool_call>/
              );
              if (rawToolCall) {
                console.log(
                  "[Provider]   Raw vim XML (first 500 chars):",
                  rawToolCall[0].substring(0, 500)
                );
              } else {
                console.log(
                  "[Provider]   Raw fullResponse (first 500 chars):",
                  fullResponse.substring(0, 500)
                );
              }
            }
          }
          let allToolResults: string[] = [];
          let hasError = false;

          // Execute all tool calls sequentially
          for (let toolIndex = 0; toolIndex < toolCalls.length; toolIndex++) {
            const toolCall = toolCalls[toolIndex];
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
              this._sendMessageToWebview({ type: "toolCallLimitReached" });
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

              if (toolCall.name === "vim" || toolCall.name.startsWith("vim_")) {
                this._sendVimStateToWebview();
              }

              this._sendMessageToWebview({
                type: "assistantMessageChunk",
                chunk: toolText,
                isFullContent: true,
              });

              // If tool execution failed, stop processing remaining tool calls
              if (toolResult.isError) {
                hasError = true;
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
            }

            // Step mode: pause after each tool call and wait for user to continue
            if (stepMode && !this.cancellationToken?.signal.aborted) {
              try {
                await this._waitForStepContinue(
                  toolIndex + 1,
                  toolCalls.length,
                  toolCall.name
                );
              } catch {
                continueLoop = false;
                break;
              }
            }

            if (hasError) {
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
            let toolResultsContent = allToolResults.join("\n\n");
            // When there was an error, prefix with explicit retry instruction so the LLM knows to fix and retry
            if (hasError) {
              toolResultsContent =
                "Tool execution failed. Fix the error and retry with a corrected tool call:\n\n" +
                toolResultsContent;
            }
            this.conversationHistory.push({
              role: "user",
              content: toolResultsContent,
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

  /** Wait for user to click "Next Step" in step mode. Resolves when stepContinue received or rejects when cancelled. */
  private _waitForStepContinue(stepIndex: number, stepTotal: number, toolName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        this.cancellationToken?.signal.removeEventListener("abort", onAbort);
        this._stepModeContinueResolve = undefined;
        reject(new Error("Cancelled"));
      };
      this._stepModeContinueResolve = () => {
        this.cancellationToken?.signal.removeEventListener("abort", onAbort);
        this._stepModeContinueResolve = undefined;
        resolve();
      };
      this.cancellationToken?.signal.addEventListener("abort", onAbort);
      this._sendMessageToWebview({
        type: "stepModePaused",
        stepIndex,
        stepTotal,
        toolName,
      });
    });
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

  private _sendVimStateToWebview() {
    const viewState = VimToolManager.getInstance().getViewState();
    this._sendMessageToWebview({
      type: "vimState",
      state: viewState,
    });
  }

  private async _handleVimNavRequest(command: string) {
    const descriptions: Record<string, string> = {
      "Ctrl+f": "scroll down one page (page down)",
      "Ctrl+b": "scroll up one page (page up)",
      "1G": "go to top of file",
      G: "go to bottom of file",
    };
    const desc = descriptions[command] ?? command;
    await this._handleUserMessage(
      `User requested vim navigation: ${desc}. Please run the vim command "${command}" so the view updates and you can see which part of the file the user is looking at.`
    );
  }

  private async _loadCurrentFileIntoVim() {
    const editor = vscode.window.activeTextEditor;
    if (!editor?.document?.uri?.fsPath || editor.document.isUntitled) {
      vscode.window.showWarningMessage("No file open. Open a file in the editor first.");
      return;
    }
    const filePath = editor.document.uri.fsPath;
    if (filePath.includes(path.sep + ".nimis")) {
      vscode.window.showWarningMessage(
        "Cannot load .nimis folder files into Vim. Open a workspace file instead."
      );
      return;
    }
    await this._handleUserMessage(
      `Please load the file at ${filePath} into vim.`
    );
  }

  private async _saveCurrentFile() {
    await this._handleUserMessage(
      "User requested to save the current file. Please use the :w vim tool call to save it."
    );
  }

  private async _handleVimCommand(command: string) {
    if (!command.trim()) {
      return;
    }
    const vim = VimToolManager.getInstance();
    try {
      const result = await vim.callTool("vim", {
        commands: [command],
      });
      const text = result.content?.map((c) => c.text).join("\n") || "";
      this._sendMessageToWebview({
        type: "vimCommandResult",
        output: text,
        isError: result.isError || false,
      });
    } catch (err: any) {
      this._sendMessageToWebview({
        type: "vimCommandResult",
        output: `Error: ${err.message}`,
        isError: true,
      });
    }
    this._sendVimStateToWebview();
  }

  private _sendMessageToWebview(message: any) {
    if (this._view) {
      this._view.webview.postMessage(message);
    }
  }

  /** Set handler to cancel the current bench run. Called by extension when bench starts. */
  public setBenchCancelHandler(handler: (() => void) | undefined) {
    this._benchCancelHandler = handler;
  }

  /** Send bench progress to the webview (Bench tab). */
  public sendBenchProgress(event: {
    phase: string;
    testId?: string;
    testIndex?: number;
    totalTests?: number;
    status?: string;
    elapsedMs?: number;
    result?: { id: string; success: boolean; durationMs: number; error?: string };
    results?: Array<{ id: string; success: boolean; durationMs: number; error?: string }>;
  }) {
    this._sendMessageToWebview({ type: "benchProgress", ...event });
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
    <div class="tab-bar">
        <button class="tab-btn active" data-tab="chat">Chat</button>
        <button class="tab-btn" data-tab="bench">Bench</button>
    </div>
    <div id="chat-tab" class="tab-panel active">
    <div id="vim-view" class="vim-view" style="display: none;">
        <div class="vim-titlebar">
            <span class="vim-filename" id="vim-filename">[No File]</span>
            <button class="vim-toggle-btn" id="vim-toggle-btn" title="Toggle Vim View">VIM</button>
        </div>
        <div class="vim-editor" id="vim-editor">
            <div class="vim-gutter" id="vim-gutter"></div>
            <div class="vim-content" id="vim-content"><span class="vim-empty">~ No buffer open ~</span></div>
        </div>
        <div class="vim-statusbar" id="vim-statusbar">
            <span class="vim-mode" id="vim-mode">NORMAL</span>
            <span class="vim-fileinfo" id="vim-fileinfo"></span>
            <span class="vim-position" id="vim-position">0,0</span>
            <div class="vim-nav-buttons">
                <button class="vim-nav-btn" id="vim-nav-pgdn" title="Page down (Ctrl+F)">PgDn</button>
                <button class="vim-nav-btn" id="vim-nav-pgup" title="Page up (Ctrl+B)">PgUp</button>
                <button class="vim-nav-btn" id="vim-nav-top" title="Go to top (1G)">Top</button>
                <button class="vim-nav-btn" id="vim-nav-bottom" title="Go to bottom (G)">Bottom</button>
            </div>
        </div>
        <div class="vim-commandrow" id="vim-commandrow">
            <span class="vim-command-prefix" id="vim-command-prefix"></span>
            <input type="text" class="vim-command-input" id="vim-command-input" spellcheck="false" autocomplete="off" placeholder="" />
        </div>
    </div>
    <div id="chat-container"></div>
    <div id="input-container">
        <div class="status-indicator" id="status-indicator">Checking connection...</div>
        <textarea id="message-input" placeholder="Type your message here..." rows="3"></textarea>
        <div class="button-group">
            <button id="send-button">Send</button>
            <button id="stop-button" class="stop-button secondary-button" style="display: none;">Stop</button>
            <button id="continue-button" class="continue-button secondary-button">Continue</button>
            <button id="question-button" class="question-button secondary-button">What?</button>
            <button id="reject-button" class="reject-button secondary-button">Decline</button>
            <button id="clear-button" class="secondary-button">Clear Chat</button>
            <button id="vim-view-toggle" class="secondary-button" title="Toggle Vim view">Vim</button>
            <button id="step-mode-toggle" class="secondary-button" title="Toggle step mode: pause after each tool call">Step</button>
            <button id="step-next-button" class="step-next-button secondary-button" style="display: none;">Next Step</button>
            <button id="load-current-file-btn" class="secondary-button" title="Load current editor file into Vim">Current File</button>
            <button id="save-current-file-btn" class="secondary-button btn-save" title="Save current file (:w vim tool call)">Save</button>
        </div>
    </div>
    </div>
    <div id="bench-tab" class="tab-panel">
        <div class="bench-toolbar">
            <button id="bench-run-all" class="bench-btn">Run All</button>
            <button id="bench-run-test" class="bench-btn secondary-button">Run Test</button>
            <button id="bench-cancel" class="bench-btn stop-button" style="display: none;">Cancel</button>
        </div>
        <div class="bench-tests-section" id="bench-tests-section" style="display: none;">
            <div class="bench-tests-header">
                <span>Select tests to run</span>
                <div class="bench-tests-actions">
                    <button id="bench-tests-ok" class="bench-btn">OK</button>
                    <button id="bench-tests-cancel" class="bench-btn secondary-button">Cancel</button>
                </div>
            </div>
            <div class="bench-tests-list" id="bench-tests-list"></div>
        </div>
        <div class="bench-progress-area" id="bench-progress-area" style="display: none;">
            <div class="bench-progress-bar">
                <div class="bench-progress-fill" id="bench-progress-fill"></div>
            </div>
            <div class="bench-status-row">
                <span class="bench-status" id="bench-status">Starting...</span>
                <span class="bench-elapsed" id="bench-elapsed">0:00</span>
            </div>
        </div>
        <div class="bench-idle-status" id="bench-idle-status">No bench running. Click Run All or Run Test to start.</div>
        <div class="bench-log" id="bench-log"></div>
    </div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
