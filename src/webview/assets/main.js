/**
 * Webview JavaScript for Nimis AI Chat Interface
 * This file is injected into the webview and handles all UI interactions
 *
 * Script load order (provider.ts): markdownFormatter.js -> vimView.js -> main.js
 * formatMarkdown and setupThinkingBlockHandlers are in global scope from markdownFormatter.js.
 * Do NOT use require() - webviews run in a browser context where require may be undefined
 * or resolve paths incorrectly in packaged extensions.
 */

// Get VS Code API (must be called synchronously when script loads)
const vscode = acquireVsCodeApi();

// Use formatMarkdown/setupThinkingBlockHandlers from global scope (loaded by markdownFormatter.js)
// Provide no-op fallbacks if markdownFormatter.js failed to load (e.g. 404 in packaged extension)
const formatMarkdownFn = typeof formatMarkdown === "function" ? formatMarkdown : function (text) { return escapeHtmlFallback(text); };
const setupThinkingBlockHandlersFn = typeof setupThinkingBlockHandlers === "function" ? setupThinkingBlockHandlers : function () {};

function escapeHtmlFallback(text) {
  if (!text) return "";
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML.replace(/\n/g, "<br>");
}

// Get DOM elements
const chatContainer = document.getElementById("chat-container");
const messageInput = document.getElementById("message-input");
const sendButton = document.getElementById("send-button");
const stopButton = document.getElementById("stop-button");
const continueButton = document.getElementById("continue-button");
const questionButton = document.getElementById("question-button");
const rejectButton = document.getElementById("reject-button");
const clearButton = document.getElementById("clear-button");
const statusIndicator = document.getElementById("status-indicator");

// State
let currentAssistantMessage = null;
let isGenerating = false;
let isCancelling = false;
let toolLimitReached = false;

/**
 * Send a message to the extension (optionally with a specific text)
 */
function sendMessage(overrideMessage) {
  const message = overrideMessage ?? (messageInput ? messageInput.value.trim() : "");
  if (message && !isGenerating) {
    vscode.postMessage({
      type: "sendMessage",
      message: message,
    });
    if (!overrideMessage && messageInput) {
      messageInput.value = "";
    }
    isGenerating = true;
    if (sendButton) sendButton.disabled = true;
    // Stop button will be shown when assistantMessageStart is received
    isCancelling = false;
  }
}

/**
 * Cancel the current operation
 */
function cancelOperation() {
  if (isGenerating && !isCancelling) {
    isCancelling = true;
    if (stopButton) {
      stopButton.disabled = true;
      stopButton.textContent = "Stopping...";
    }
    vscode.postMessage({
      type: "cancelRequest",
    });
  }
}

/**
 * Add a message to the chat container
 */
function addMessage(content, type) {
  if (!chatContainer) return null;
  const messageDiv = document.createElement("div");
  messageDiv.className = `message message-${type}`;
  messageDiv.textContent = content;
  chatContainer.appendChild(messageDiv);
  chatContainer.scrollTop = chatContainer.scrollHeight;
  return messageDiv;
}

/**
 * Format message content with markdown
 */
function formatMessageContent(messageDiv) {
  const content = messageDiv.textContent;
  const formatted = formatMarkdownFn(content);
  messageDiv.innerHTML = formatted;

  // Add copy button event listeners
  const copyButtons = messageDiv.querySelectorAll(".copy-button");
  copyButtons.forEach((button) => {
    button.addEventListener("click", function () {
      const code = this.getAttribute("data-code");
      navigator.clipboard.writeText(code).then(() => {
        const originalText = this.textContent;
        this.textContent = "Copied!";
        this.classList.add("copied");
        setTimeout(() => {
          this.textContent = originalText;
          this.classList.remove("copied");
        }, 2000);
      });
    });
  });

  setupThinkingBlockHandlersFn(messageDiv);
}

/**
 * Add insert button to code blocks
 */
function addInsertButton(messageDiv) {
  const codeContainers = messageDiv.querySelectorAll(".code-block-container");

  codeContainers.forEach((container) => {
    const codeBlock = container.querySelector("code");
    if (codeBlock && !container.querySelector(".insert-button")) {
      const button = document.createElement("button");
      button.textContent = "Insert at Cursor";
      button.className = "insert-button";
      button.addEventListener("click", () => {
        vscode.postMessage({
          type: "insertCode",
          code: codeBlock.textContent,
        });
      });

      // Add to header if it exists, otherwise create one
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

/**
 * Event Listeners - guard against null elements (can happen if webview loads before DOM ready)
 */
function initEventListeners() {
  if (sendButton) sendButton.addEventListener("click", () => sendMessage());
  if (stopButton) stopButton.addEventListener("click", cancelOperation);
  if (continueButton) continueButton.addEventListener("click", () => sendMessage("Yes, please continue."));
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
      vscode.postMessage({ type: "clearChat" });
    });
  }
}

initEventListeners();

/**
 * Handle messages from the extension
 */
window.addEventListener("message", (event) => {
  const message = event.data;

  switch (message.type) {
    case "userMessage":
      addMessage(message.message, "user");
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
        // Server sends preprocessed full content each time (isFullContent: true)
        currentAssistantMessage.textContent = message.chunk;
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
      toolLimitReached = false;
      isCancelling = false;
      break;

    case "error":
      addMessage(message.message, "error");
      isGenerating = false;
      if (sendButton) sendButton.disabled = false;
      if (stopButton) stopButton.style.display = "none";
      toolLimitReached = false;
      isCancelling = false;
      break;

    case "cancellationInProgress":
      // Visual feedback that cancellation is in progress
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
      toolLimitReached = false;
      isCancelling = false;
      currentAssistantMessage = null;
      break;

    case "setInput":
      if (messageInput) {
        messageInput.value = message.message;
        messageInput.focus();
      }
      break;

    case "requestFeedback":
      addMessage(message.message, "system");
      break;

    case "toolCallLimitReached":
      toolLimitReached = true;
      break;

    case "vimState":
      if (typeof VimView !== "undefined") {
        VimView.updateState(message.state);
      }
      break;

    case "vimCommandResult":
      if (typeof VimView !== "undefined") {
        VimView.setCommandOutput(message.output);
      }
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
      break;
  }
});

/**
 * Initialize: Check connection after message listener is set up
 * Also ensure Stop button is hidden by default
 */
setTimeout(() => {
  vscode.postMessage({ type: "checkConnection" });
  if (stopButton) stopButton.style.display = "none";
  isGenerating = false;
  isCancelling = false;
}, 100);
