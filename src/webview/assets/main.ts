/**
 * Webview entry for Nimis AI Chat Interface.
 * Bundled by webpack; runs in browser context.
 */

declare function acquireVsCodeApi(): { postMessage: (msg: unknown) => void };

// Must be called synchronously when script loads
const vscode = acquireVsCodeApi();

import { formatMarkdown, setupThinkingBlockHandlers } from "./markdownFormatter";
import { initVimView } from "./vimView";
import { initBench } from "./bench";

// Initialize VimView and Bench (expose on window for message handler)
const VimView = initVimView(() => vscode);
const Bench = initBench(() => vscode);
(globalThis as unknown as { VimView: typeof VimView }).VimView = VimView;
(globalThis as unknown as { Bench: typeof Bench }).Bench = Bench;

const formatMarkdownFn = formatMarkdown;
const setupThinkingBlockHandlersFn = setupThinkingBlockHandlers;

const chatContainer = document.getElementById("chat-container");
const messageInput = document.getElementById("message-input") as HTMLTextAreaElement | null;
const sendButton = document.getElementById("send-button") as HTMLButtonElement | null;
const stopButton = document.getElementById("stop-button") as HTMLButtonElement | null;
const continueButton = document.getElementById("continue-button") as HTMLButtonElement | null;
const stepNextButton = document.getElementById("step-next-button") as HTMLButtonElement | null;
const questionButton = document.getElementById("question-button") as HTMLButtonElement | null;
const rejectButton = document.getElementById("reject-button") as HTMLButtonElement | null;
const clearButton = document.getElementById("clear-button") as HTMLButtonElement | null;
const loadCurrentFileBtn = document.getElementById("load-current-file-btn") as HTMLButtonElement | null;
const saveCurrentFileBtn = document.getElementById("save-current-file-btn") as HTMLButtonElement | null;
const stepModeToggle = document.getElementById("step-mode-toggle") as HTMLButtonElement | null;
const statusIndicator = document.getElementById("status-indicator");

let currentAssistantMessage: HTMLElement | null = null;
let isGenerating = false;
let isCancelling = false;
let toolLimitReached = false;

function sendMessage(overrideMessage?: string): void {
  const message = overrideMessage ?? (messageInput ? messageInput.value.trim() : "");
  if (message && !isGenerating) {
    vscode.postMessage({ type: "sendMessage", message });
    if (!overrideMessage && messageInput) {
      messageInput.value = "";
    }
    isGenerating = true;
    if (sendButton) sendButton.disabled = true;
    isCancelling = false;
  }
}

function cancelOperation(): void {
  if (isGenerating && !isCancelling) {
    isCancelling = true;
    if (stopButton) {
      stopButton.disabled = true;
      stopButton.textContent = "Stopping...";
    }
    vscode.postMessage({ type: "cancelRequest" });
  }
}

function addMessage(content: string, type: string): HTMLElement | null {
  if (!chatContainer) return null;
  const messageDiv = document.createElement("div");
  messageDiv.className = `message message-${type}`;
  messageDiv.textContent = content;
  chatContainer.appendChild(messageDiv);
  chatContainer.scrollTop = chatContainer.scrollHeight;
  return messageDiv;
}

function formatMessageContent(messageDiv: HTMLElement): void {
  const content = messageDiv.textContent ?? "";
  const formatted = formatMarkdownFn(content);
  messageDiv.innerHTML = formatted;

  const copyButtons = messageDiv.querySelectorAll(".copy-button");
  copyButtons.forEach((button) => {
    button.addEventListener("click", function (this: HTMLElement) {
      const code = this.getAttribute("data-code");
      if (code) {
        navigator.clipboard.writeText(code).then(() => {
          const originalText = this.textContent ?? "";
          this.textContent = "Copied!";
          this.classList.add("copied");
          setTimeout(() => {
            this.textContent = originalText;
            this.classList.remove("copied");
          }, 2000);
        });
      }
    });
  });

  setupThinkingBlockHandlersFn(messageDiv);
}

function addInsertButton(messageDiv: HTMLElement): void {
  const codeContainers = messageDiv.querySelectorAll(".code-block-container");

  codeContainers.forEach((container) => {
    const codeBlock = container.querySelector("code");
    if (codeBlock && !container.querySelector(".insert-button")) {
      const button = document.createElement("button");
      button.textContent = "Insert at Cursor";
      button.className = "insert-button";
      button.addEventListener("click", () => {
        vscode.postMessage({ type: "insertCode", code: codeBlock.textContent });
      });

      let header = container.querySelector(".code-block-header");
      if (header) {
        header.appendChild(button);
      } else {
        const newHeader = document.createElement("div");
        newHeader.className = "code-block-header";
        newHeader.appendChild(button);
        container.insertBefore(newHeader, container.firstChild);
      }
    }
  });
}

function initEventListeners(): void {
  if (sendButton) sendButton.addEventListener("click", () => sendMessage());
  if (stopButton) stopButton.addEventListener("click", cancelOperation);
  if (continueButton) continueButton.addEventListener("click", () => sendMessage("Yes, please continue."));
  if (stepNextButton) {
    stepNextButton.addEventListener("click", () => {
      vscode.postMessage({ type: "stepContinue" });
      if (stepNextButton) stepNextButton.style.display = "none";
    });
  }
  if (questionButton) questionButton.addEventListener("click", () => sendMessage("what happened"));
  if (rejectButton) rejectButton.addEventListener("click", () => sendMessage("No, that's not what I wanted."));
  if (messageInput) {
    messageInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        sendMessage();
      }
    });
  }
  if (clearButton) {
    clearButton.addEventListener("click", () => {
      if (chatContainer) chatContainer.innerHTML = "";
      toolLimitReached = false;
      if (stepNextButton) stepNextButton.style.display = "none";
      vscode.postMessage({ type: "clearChat" });
    });
  }
  if (loadCurrentFileBtn) {
    loadCurrentFileBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "loadCurrentFileIntoVim" });
    });
  }
  if (stepModeToggle) {
    stepModeToggle.addEventListener("click", () => {
      vscode.postMessage({ type: "toggleStepMode" });
    });
  }
  if (saveCurrentFileBtn) {
    saveCurrentFileBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "saveCurrentFile" });
    });
  }
}

initEventListeners();

function initTabs(): void {
  const tabBtns = document.querySelectorAll(".tab-btn");
  const tabPanels = document.querySelectorAll(".tab-panel");
  tabBtns.forEach((btn) => {
    btn.addEventListener("click", function (this: HTMLElement) {
      const tab = this.getAttribute("data-tab");
      tabBtns.forEach((b) => b.classList.remove("active"));
      tabPanels.forEach((p) => {
        p.classList.toggle("active", p.id === tab + "-tab");
      });
      this.classList.add("active");
      if (tab !== "bench") {
        Bench.hideTestsSection();
      }
    });
  });
}
initTabs();

interface WebviewMessage {
  type: string;
  message?: string;
  chunk?: string;
  state?: unknown;
  output?: string;
  connected?: boolean;
  stepMode?: boolean;
  tests?: unknown[];
  [key: string]: unknown;
}

window.addEventListener("message", (event: MessageEvent<WebviewMessage>) => {
  const message = event.data;

  switch (message.type) {
    case "userMessage":
      addMessage(message.message ?? "", "user");
      break;

    case "assistantMessageStart":
      currentAssistantMessage = addMessage("", "assistant");
      isGenerating = true;
      if (sendButton) sendButton.disabled = true;
      if (stopButton) {
        stopButton.style.display = "inline-block";
        stopButton.disabled = false;
        stopButton.textContent = "Stop";
      }
      isCancelling = false;
      break;

    case "assistantMessageChunk":
      if (currentAssistantMessage) {
        currentAssistantMessage.textContent = message.chunk ?? "";
        formatMessageContent(currentAssistantMessage);
        if (chatContainer) chatContainer.scrollTop = chatContainer.scrollHeight;
      }
      break;

    case "assistantMessageEnd":
      if (currentAssistantMessage) {
        addInsertButton(currentAssistantMessage);
      }
      currentAssistantMessage = null;
      isGenerating = false;
      if (sendButton) sendButton.disabled = false;
      if (stopButton) stopButton.style.display = "none";
      if (stepNextButton) stepNextButton.style.display = "none";
      toolLimitReached = false;
      isCancelling = false;
      break;

    case "error":
      addMessage(message.message ?? "", "error");
      isGenerating = false;
      if (sendButton) sendButton.disabled = false;
      if (stopButton) stopButton.style.display = "none";
      if (stepNextButton) stepNextButton.style.display = "none";
      toolLimitReached = false;
      isCancelling = false;
      break;

    case "cancellationInProgress":
      if (currentAssistantMessage && chatContainer) {
        const cancelIndicator = document.createElement("div");
        cancelIndicator.className = "message message-system";
        cancelIndicator.textContent = "Cancelling operation...";
        chatContainer.appendChild(cancelIndicator);
        chatContainer.scrollTop = chatContainer.scrollHeight;
      }
      break;

    case "cancellationComplete":
      isGenerating = false;
      if (sendButton) sendButton.disabled = false;
      if (stopButton) {
        stopButton.style.display = "none";
        stopButton.disabled = false;
        stopButton.textContent = "Stop";
      }
      if (stepNextButton) stepNextButton.style.display = "none";
      toolLimitReached = false;
      isCancelling = false;
      currentAssistantMessage = null;
      break;

    case "setInput":
      if (messageInput) {
        messageInput.value = message.message ?? "";
        messageInput.focus();
      }
      break;

    case "requestFeedback":
      addMessage(message.message ?? "", "system");
      break;

    case "toolCallLimitReached":
      toolLimitReached = true;
      break;

    case "stepModePaused": {
      const stepIndex = (message.stepIndex as number) ?? 1;
      const stepTotal = (message.stepTotal as number) ?? 1;
      const toolName = (message.toolName as string) ?? "tool";
      const text = `[Step mode] Paused after tool ${stepIndex}/${stepTotal}: ${toolName}. Click "Next Step" to continue.`;
      const existing = chatContainer?.querySelector(".step-mode-reminder");
      if (existing) {
        existing.textContent = text;
      } else {
        const div = addMessage(text, "system");
        if (div) div.classList.add("step-mode-reminder");
      }
      if (stepNextButton) {
        stepNextButton.textContent = `Next Step (${stepIndex}/${stepTotal})`;
        stepNextButton.style.display = "inline-block";
      }
      break;
    }

    case "vimState":
      VimView.updateState(message.state as Parameters<typeof VimView.updateState>[0]);
      break;

    case "vimCommandResult":
      VimView.setCommandOutput(message.output ?? "");
      break;

    case "directiveHandled":
      isGenerating = false;
      if (sendButton) sendButton.disabled = false;
      break;

    case "connectionStatus":
      if (statusIndicator) {
        if (message.connected) {
          statusIndicator.textContent = "Connected to LLM";
          statusIndicator.className = "status-indicator status-connected";
        } else {
          statusIndicator.textContent = "Not connected to LLM";
          statusIndicator.className = "status-indicator status-disconnected";
        }
      }
      if (stepModeToggle !== null && message.stepMode !== undefined) {
        stepModeToggle.classList.toggle("active", message.stepMode as boolean);
      }
      break;

    case "stepModeState":
      if (stepModeToggle !== null && message.stepMode !== undefined) {
        stepModeToggle.classList.toggle("active", message.stepMode as boolean);
      }
      break;

    case "benchProgress":
    case "benchConfig":
      Bench.handleMessage(message as unknown as Parameters<typeof Bench.handleMessage>[0]);
      break;
  }
});

setTimeout(() => {
  vscode.postMessage({ type: "checkConnection" });
  if (stopButton) stopButton.style.display = "none";
  isGenerating = false;
  isCancelling = false;
}, 100);
