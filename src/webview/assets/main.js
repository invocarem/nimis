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
const benchStatusEl = document.getElementById("bench-status");
const benchLogEl = document.getElementById("bench-log");
const benchProgressArea = document.getElementById("bench-progress-area");
const benchProgressFill = document.getElementById("bench-progress-fill");
const benchElapsedEl = document.getElementById("bench-elapsed");
const benchIdleStatus = document.getElementById("bench-idle-status");
const benchRunAllBtn = document.getElementById("bench-run-all");
const benchRunTestBtn = document.getElementById("bench-run-test");
const benchCancelBtn = document.getElementById("bench-cancel");
const benchTestsList = document.getElementById("bench-tests-list");
const benchTestsSection = document.getElementById("bench-tests-section");
const benchTestsOkBtn = document.getElementById("bench-tests-ok");
const benchTestsCancelBtn = document.getElementById("bench-tests-cancel");

var benchElapsedInterval = null;
var benchTests = [];

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
 * Tab switching: Chat | Bench
 */
function initTabs() {
  const tabBtns = document.querySelectorAll(".tab-btn");
  const tabPanels = document.querySelectorAll(".tab-panel");
  tabBtns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      const tab = btn.getAttribute("data-tab");
      tabBtns.forEach(function (b) { b.classList.remove("active"); });
      tabPanels.forEach(function (p) {
        p.classList.toggle("active", p.id === tab + "-tab");
      });
      btn.classList.add("active");
      if (tab !== "bench") {
        hideBenchTestsSection();
      }
    });
  });
}
initTabs();

function initBenchButtons() {
  if (benchRunAllBtn) {
    benchRunAllBtn.addEventListener("click", function () {
      vscode.postMessage({ type: "runBench" });
    });
  }
  if (benchRunTestBtn) {
    benchRunTestBtn.addEventListener("click", function () {
      showBenchTestsSection();
    });
  }
  if (benchTestsOkBtn) {
    benchTestsOkBtn.addEventListener("click", function () {
      var ids = getSelectedBenchTestIds();
      hideBenchTestsSection();
      vscode.postMessage({ type: "runBenchSelected", testIds: ids });
    });
  }
  if (benchTestsCancelBtn) {
    benchTestsCancelBtn.addEventListener("click", function () {
      hideBenchTestsSection();
    });
  }
  if (benchCancelBtn) {
    benchCancelBtn.addEventListener("click", function () {
      vscode.postMessage({ type: "cancelBench" });
    });
  }
}
initBenchButtons();

function showBenchTestsSection() {
  if (benchTestsSection) {
    benchTestsSection.style.display = "flex";
    vscode.postMessage({ type: "requestBenchConfig" });
  }
}

function hideBenchTestsSection() {
  if (benchTestsSection) {
    benchTestsSection.style.display = "none";
  }
}

function getSelectedBenchTestIds() {
  if (!benchTestsList) return [];
  var checkboxes = benchTestsList.querySelectorAll(".bench-test-item input[type=checkbox]:checked");
  return Array.prototype.map.call(checkboxes, function (cb) { return cb.value; });
}

function renderBenchTests(tests) {
  benchTests = tests || [];
  if (!benchTestsList) return;
  benchTestsList.innerHTML = "";
  if (benchTests.length === 0) {
    var empty = document.createElement("div");
    empty.className = "bench-tests-empty";
    empty.textContent = "No bench configured. Set nimis.benchPath or nimis.bench in settings.";
    benchTestsList.appendChild(empty);
    return;
  }
  benchTests.forEach(function (t) {
    var item = document.createElement("div");
    item.className = "bench-test-item";
    var cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = t.id;
    cb.id = "bench-test-" + t.id;
    var label = document.createElement("label");
    label.htmlFor = cb.id;
    label.className = "bench-test-id";
    label.textContent = t.id;
    item.addEventListener("click", function (e) {
      if (e.target !== cb) {
        cb.checked = !cb.checked;
      }
    });
    item.appendChild(cb);
    item.appendChild(label);
    benchTestsList.appendChild(item);
  });
}

function startBenchElapsedTimer() {
  var start = Date.now();
  if (benchElapsedInterval) clearInterval(benchElapsedInterval);
  benchElapsedInterval = setInterval(function () {
    if (benchElapsedEl) {
      var sec = Math.floor((Date.now() - start) / 1000);
      var m = Math.floor(sec / 60);
      var s = sec % 60;
      benchElapsedEl.textContent = m + ":" + (s < 10 ? "0" : "") + s;
    }
  }, 500);
}

function stopBenchElapsedTimer() {
  if (benchElapsedInterval) {
    clearInterval(benchElapsedInterval);
    benchElapsedInterval = null;
  }
}

function showBenchRunning(show) {
  if (benchProgressArea) benchProgressArea.style.display = show ? "block" : "none";
  if (benchIdleStatus) benchIdleStatus.style.display = show ? "none" : "block";
  if (benchCancelBtn) benchCancelBtn.style.display = show ? "inline-block" : "none";
  if (benchRunAllBtn) benchRunAllBtn.disabled = show;
  if (benchRunTestBtn) benchRunTestBtn.disabled = show;
}

function setBenchProgressBar(percent) {
  if (!benchProgressFill) return;
  benchProgressFill.classList.remove("indeterminate");
  benchProgressFill.style.width = (percent != null ? percent : 0) + "%";
}

function setBenchProgressIndeterminate() {
  if (!benchProgressFill) return;
  benchProgressFill.classList.add("indeterminate");
}

/**
 * Bench progress: update status and log
 */
function handleBenchProgress(data) {
  if (!benchStatusEl || !benchLogEl) return;
  if (data.phase === "start") {
    showBenchRunning(true);
    setBenchProgressIndeterminate();
    startBenchElapsedTimer();
    benchStatusEl.textContent = "Bench starting...";
    if (benchElapsedEl) benchElapsedEl.textContent = "0:00";
    benchLogEl.textContent = "";
    var benchTabBtn = document.querySelector('.tab-btn[data-tab="bench"]');
    if (benchTabBtn) benchTabBtn.click();
  } else if (data.phase === "testStart") {
    var total = data.totalTests || 1;
    var idx = data.testIndex || 0;
    var pct = total > 0 ? ((idx - 1) / total) * 100 : 0;
    setBenchProgressBar(pct);
    benchStatusEl.textContent = "Running: " + (data.testId || "?") + " (" + idx + "/" + total + ")";
    benchLogEl.textContent += "[" + idx + "/" + total + "] " + (data.testId || "?") + "\n";
  } else if (data.phase === "progress") {
    setBenchProgressIndeterminate();
    benchStatusEl.textContent = (data.testId || "?") + " – " + (data.status || "...");
    if (benchElapsedEl && data.elapsedMs != null) {
      var sec = Math.floor(data.elapsedMs / 1000);
      var m = Math.floor(sec / 60);
      var s = sec % 60;
      benchElapsedEl.textContent = m + ":" + (s < 10 ? "0" : "") + s;
    }
    if (data.status) {
      benchLogEl.textContent += "  " + data.status + "\n";
    }
  } else if (data.phase === "testComplete") {
    var total = data.totalTests || 1;
    var idx = data.testIndex || 0;
    var pct = total > 0 ? (idx / total) * 100 : 100;
    setBenchProgressBar(pct);
    var r = data.result;
    var s = r && r.success ? "PASS" : "FAIL";
    var dur = r ? (r.durationMs / 1000).toFixed(2) + "s" : "?";
    benchLogEl.textContent += "  " + s + "  " + dur + "\n";
    if (r && r.error) {
      benchLogEl.textContent += "    " + r.error + "\n";
    }
  } else if (data.phase === "complete") {
    setBenchProgressBar(100);
    stopBenchElapsedTimer();
    showBenchRunning(false);
    var results = data.results || [];
    var passed = results.filter(function (r) { return r.success; }).length;
    var total = results.length;
    benchStatusEl.textContent = "Done: " + passed + "/" + total + " passed";
    if (benchIdleStatus) benchIdleStatus.textContent = "Done: " + passed + "/" + total + " passed. Click Run All or Run Test to run again.";
    benchLogEl.textContent += "\nSummary: " + passed + "/" + total + " passed\n";
    results.forEach(function (r) {
      benchLogEl.textContent += "  " + (r.success ? "PASS" : "FAIL") + "  " + r.id + "\n";
    });
  }
  benchLogEl.scrollTop = benchLogEl.scrollHeight;
}
function formatElapsed(ms) {
  if (ms == null) return "0s";
  if (ms < 1000) return ms + "ms";
  return (ms / 1000).toFixed(1) + "s";
}

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

    case "benchProgress":
      handleBenchProgress(message);
      break;

    case "benchConfig":
      renderBenchTests(message.tests);
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
