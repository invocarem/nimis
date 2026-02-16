/**
 * Webview JavaScript for Nimis AI Chat Interface
 * This file is injected into the webview and handles all UI interactions
 */

// Import formatting utilities
// Note: In production, this would be bundled, but for development we load it separately
if (typeof require !== "undefined") {
  var { formatMarkdown, setupThinkingBlockHandlers } =
    require("./markdownFormatter.js");
} else {
  // Fallback for when not in Node environment
  console.warn("markdownFormatter not loaded, using fallback");
}

// Get VS Code API
const vscode = acquireVsCodeApi();

// Get DOM elements
const chatContainer = document.getElementById("chat-container");
const messageInput = document.getElementById("message-input");
const sendButton = document.getElementById("send-button");
const clearButton = document.getElementById("clear-button");
const statusIndicator = document.getElementById("status-indicator");

// State
let currentAssistantMessage = null;
let isGenerating = false;

/**
 * Send a message to the extension
 */
function sendMessage() {
  const message = messageInput.value.trim();
  if (message && !isGenerating) {
    vscode.postMessage({
      type: "sendMessage",
      message: message,
    });
    messageInput.value = "";
    isGenerating = true;
    sendButton.disabled = true;
  }
}

/**
 * Add a message to the chat container
 */
function addMessage(content, type) {
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
  const formatted = formatMarkdown(content);
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

  setupThinkingBlockHandlers(messageDiv);
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
 * Event Listeners
 */
sendButton.addEventListener("click", sendMessage);

messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    sendMessage();
  }
});

clearButton.addEventListener("click", () => {
  chatContainer.innerHTML = "";
  vscode.postMessage({ type: "clearChat" });
});

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
      break;

    case "assistantMessageChunk":
      if (currentAssistantMessage) {
        // Server sends preprocessed full content each time (isFullContent: true)
        currentAssistantMessage.textContent = message.chunk;
        formatMessageContent(currentAssistantMessage);
        chatContainer.scrollTop = chatContainer.scrollHeight;
      }
      break;

    case "assistantMessageEnd":
      if (currentAssistantMessage) {
        addInsertButton(currentAssistantMessage);
      }
      currentAssistantMessage = null;
      isGenerating = false;
      sendButton.disabled = false;
      break;

    case "error":
      addMessage(message.message, "error");
      isGenerating = false;
      sendButton.disabled = false;
      break;

    case "setInput":
      messageInput.value = message.message;
      messageInput.focus();
      break;

    case "connectionStatus":
      if (message.connected) {
        statusIndicator.textContent = "Connected to llama.cpp";
        statusIndicator.className = "status-indicator status-connected";
      } else {
        statusIndicator.textContent = "Not connected to llama.cpp";
        statusIndicator.className = "status-indicator status-disconnected";
      }
      break;
  }
});

/**
 * Initialize: Check connection after message listener is set up
 */
setTimeout(() => {
  vscode.postMessage({ type: "checkConnection" });
}, 100);
