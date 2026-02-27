/**
 * Vim View – a live display of the VimToolManager buffer state.
 * Shows file content with line numbers, a status bar, and a command row.
 */

// eslint-disable-next-line no-unused-vars
var VimView = (function () {
  var VIM_ROWS = 24;
  var VIM_COLS = 80;

  var visible = false;
  var lastState = null;
  var lastCommandOutput = "";
  var viewportTop = 0;

  var els = {};

  function init() {
    els.view = document.getElementById("vim-view");
    els.filename = document.getElementById("vim-filename");
    els.toggleBtn = document.getElementById("vim-toggle-btn");
    els.editor = document.getElementById("vim-editor");
    els.gutter = document.getElementById("vim-gutter");
    els.content = document.getElementById("vim-content");
    els.mode = document.getElementById("vim-mode");
    els.fileinfo = document.getElementById("vim-fileinfo");
    els.position = document.getElementById("vim-position");
    els.statusbar = document.getElementById("vim-statusbar");
    els.commandRow = document.getElementById("vim-commandrow");
    els.commandPrefix = document.getElementById("vim-command-prefix");
    els.commandInput = document.getElementById("vim-command-input");
    els.viewToggleBtn = document.getElementById("vim-view-toggle");

    els.toggleBtn.addEventListener("click", toggle);
    els.viewToggleBtn.addEventListener("click", toggle);

    els.commandInput.addEventListener("keydown", onCommandKeyDown);
  }

  function toggle() {
    visible = !visible;
    els.view.style.display = visible ? "flex" : "none";
    if (visible) {
      // Request fresh state on open
      // eslint-disable-next-line no-undef
      vscode.postMessage({ type: "requestVimState" });
    }
  }

  function show() {
    if (!visible) {
      visible = true;
      els.view.style.display = "flex";
    }
  }

  function onCommandKeyDown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      var cmd = els.commandInput.value;
      if (!cmd) return;
      var fullCmd = ":" + cmd;
      els.commandInput.value = "";
      // eslint-disable-next-line no-undef
      vscode.postMessage({ type: "vimCommand", command: fullCmd });
    } else if (e.key === "Escape") {
      e.preventDefault();
      els.commandInput.value = "";
      els.commandInput.blur();
    }
  }

  function updateState(state) {
    lastState = state;
    if (!state) {
      renderEmpty();
      return;
    }
    show();
    renderBuffer(state);
    renderStatusBar(state);
    renderCommandRow(state);
  }

  function renderEmpty() {
    els.filename.textContent = "[No File]";
    viewportTop = 0;

    var gutterLines = [];
    var contentLines = [];
    for (var i = 0; i < VIM_ROWS; i++) {
      gutterLines.push("~");
      contentLines.push('<span class="vim-line vim-tilde">~</span>');
    }
    els.gutter.textContent = gutterLines.join("\n");
    els.content.innerHTML = contentLines.join("");

    els.mode.textContent = "NORMAL";
    els.mode.className = "vim-mode";
    els.fileinfo.textContent = "";
    els.position.textContent = "0,0";
    els.commandPrefix.textContent = "";
    els.commandInput.value = "";
  }

  function renderBuffer(state) {
    var nameHtml = escapeHtml(state.fileName);
    if (state.modified) {
      nameHtml += '<span class="vim-modified"> [+]</span>';
    }
    els.filename.innerHTML = nameHtml;

    var lines = state.lines;
    var totalLines = lines.length;
    var cursorLine = state.cursorLine;

    // Keep cursor within the viewport window
    if (cursorLine < viewportTop) {
      viewportTop = cursorLine;
    } else if (cursorLine >= viewportTop + VIM_ROWS) {
      viewportTop = cursorLine - VIM_ROWS + 1;
    }

    var gutterWidth = Math.max(String(totalLines).length, String(viewportTop + VIM_ROWS).length);
    var gutterLines = [];
    var contentLines = [];

    for (var i = 0; i < VIM_ROWS; i++) {
      var lineIdx = viewportTop + i;
      if (lineIdx < totalLines) {
        var lineNum = String(lineIdx + 1).padStart(gutterWidth, " ");
        gutterLines.push(lineNum);

        var lineText = escapeHtml(lines[lineIdx]) || " ";
        var cls = "vim-line";
        if (lineIdx === cursorLine) cls += " vim-cursor-line";
        contentLines.push('<span class="' + cls + '">' + lineText + "</span>");
      } else {
        gutterLines.push(padStart("~", gutterWidth, " "));
        contentLines.push('<span class="vim-line vim-tilde">~</span>');
      }
    }

    els.gutter.textContent = gutterLines.join("\n");
    els.content.innerHTML = contentLines.join("");
  }

  function renderStatusBar(state) {
    var modeText = state.mode.toUpperCase();
    if (state.mode === "command-line") modeText = "COMMAND";
    els.mode.textContent = "-- " + modeText + " --";

    els.mode.className = "vim-mode";
    if (state.mode === "insert") els.mode.classList.add("vim-mode--insert");
    else if (state.mode === "command-line") els.mode.classList.add("vim-mode--command");

    var info = state.filePath || "";
    if (state.modified) info += " [+]";
    info += "  " + state.totalLines + "L";
    els.fileinfo.textContent = info;

    var col = state.cursorCol !== undefined ? state.cursorCol + 1 : 1;
    els.position.textContent = (state.cursorLine + 1) + "," + col;
  }

  function renderCommandRow(state) {
    if (state.mode === "command-line" && state.commandBuffer) {
      els.commandPrefix.textContent = ":";
      els.commandInput.value = state.commandBuffer;
    } else if (lastCommandOutput) {
      els.commandPrefix.textContent = "";
      els.commandInput.value = "";
      els.commandInput.placeholder = lastCommandOutput;
    } else {
      els.commandPrefix.textContent = "";
      els.commandInput.value = "";
      els.commandInput.placeholder = "";
    }
  }

  function setCommandOutput(output) {
    lastCommandOutput = output || "";
    if (lastState) {
      renderCommandRow(lastState);
    }
  }

  function escapeHtml(text) {
    if (!text) return "";
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function padStart(str, len, ch) {
    while (str.length < len) str = ch + str;
    return str;
  }

  return {
    init: init,
    toggle: toggle,
    show: show,
    updateState: updateState,
    setCommandOutput: setCommandOutput,
    isVisible: function () { return visible; },
    rows: function () { return VIM_ROWS; },
    cols: function () { return VIM_COLS; },
  };
})();

// Init immediately if DOM already loaded, otherwise wait
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", function () {
    VimView.init();
  });
} else {
  VimView.init();
}
