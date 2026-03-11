/**
 * Vim View – a live display of the VimToolManager buffer state.
 * Shows file content with line numbers, a status bar, and a command row.
 */

export interface VimState {
  fileName: string;
  filePath: string;
  lines: string[];
  cursorLine: number;
  cursorCol?: number;
  mode: string;
  modified: boolean;
  totalLines: number;
  list?: boolean;
  tabstop?: number;
  viewportTop?: number;
  mode_command?: boolean;
  commandBuffer?: string;
}

interface VimViewApi {
  init: () => void;
  toggle: () => void;
  show: () => void;
  updateState: (state: VimState | null) => void;
  setCommandOutput: (output: string) => void;
  isVisible: () => boolean;
  rows: () => number;
  cols: () => number;
  hideTestsSection?: () => void;
}

export interface VscodeApi {
  postMessage: (msg: unknown) => void;
}

function createVimView(getVscode: () => VscodeApi): VimViewApi {
  const VIM_ROWS = 24;
  const VIM_COLS = 80;

  let visible = false;
  let lastState: VimState | null = null;
  let lastCommandOutput = "";
  let viewportTop = 0;

  const els: Record<string, HTMLElement> = {};

  function init(): void {
    els.view = document.getElementById("vim-view")!;
    els.filename = document.getElementById("vim-filename")!;
    els.toggleBtn = document.getElementById("vim-toggle-btn")!;
    els.editor = document.getElementById("vim-editor")!;
    els.gutter = document.getElementById("vim-gutter")!;
    els.content = document.getElementById("vim-content")!;
    els.mode = document.getElementById("vim-mode")!;
    els.fileinfo = document.getElementById("vim-fileinfo")!;
    els.position = document.getElementById("vim-position")!;
    els.statusbar = document.getElementById("vim-statusbar")!;
    els.commandRow = document.getElementById("vim-commandrow")!;
    els.commandPrefix = document.getElementById("vim-command-prefix")!;
    els.commandInput = document.getElementById("vim-command-input") as HTMLInputElement;
    els.viewToggleBtn = document.getElementById("vim-view-toggle")!;

    els.toggleBtn.addEventListener("click", toggle);
    els.viewToggleBtn.addEventListener("click", toggle);
    els.commandInput.addEventListener("keydown", onCommandKeyDown);
  }

  function toggle(): void {
    visible = !visible;
    els.view.style.display = visible ? "flex" : "none";
    if (visible) {
      getVscode().postMessage({ type: "requestVimState" });
    }
  }

  function show(): void {
    if (!visible) {
      visible = true;
      els.view.style.display = "flex";
    }
  }

  function onCommandKeyDown(e: KeyboardEvent): void {
    if (e.key === "Enter") {
      e.preventDefault();
      const cmd = (els.commandInput as HTMLInputElement).value;
      if (!cmd) return;
      const fullCmd = ":" + cmd;
      (els.commandInput as HTMLInputElement).value = "";
      getVscode().postMessage({ type: "vimCommand", command: fullCmd });
    } else if (e.key === "Escape") {
      e.preventDefault();
      (els.commandInput as HTMLInputElement).value = "";
      els.commandInput.blur();
    }
  }

  function updateState(state: VimState | null): void {
    lastState = state;
    if (!state) {
      lastCommandOutput = "";
      renderEmpty();
      return;
    }
    show();
    renderBuffer(state);
    renderStatusBar(state);
    renderCommandRow(state);
  }

  function renderEmpty(): void {
    els.filename.textContent = "[No File]";
    viewportTop = 0;

    const gutterLines: string[] = [];
    const contentLines: string[] = [];
    for (let i = 0; i < VIM_ROWS; i++) {
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
    (els.commandInput as HTMLInputElement).value = "";
  }

  function escapeHtml(text: string): string {
    if (!text) return "";
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function padStart(str: string, len: number, ch: string): string {
    while (str.length < len) str = ch + str;
    return str;
  }

  function renderListLine(line: string, tabstop: number): string {
    let result = "";
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === "\t") {
        const col = result.replace(/<[^>]*>/g, "").length;
        const width = tabstop - (col % tabstop);
        const fill = width > 1 ? new Array(width).join("-") : "";
        result += '<span class="vim-list-tab">&gt;' + fill + "</span>";
      } else {
        result += escapeHtml(ch);
      }
    }
    const trailMatch = result.match(/((?:\xB7| )+)$/);
    if (trailMatch) {
      const plain = result.slice(0, result.length - trailMatch[1].length);
      const dots = trailMatch[1].replace(/ /g, "\xB7");
      result = plain + '<span class="vim-list-trail">' + dots + "</span>";
    }
    result += '<span class="vim-list-eol">$</span>';
    return result;
  }

  function renderBuffer(state: VimState): void {
    let nameHtml = escapeHtml(state.fileName);
    if (state.modified) {
      nameHtml += '<span class="vim-modified"> [+]</span>';
    }
    els.filename.innerHTML = nameHtml;

    const lines = state.lines;
    const totalLines = lines.length;
    const cursorLine = state.cursorLine;
    const listMode = state.list ?? false;
    const tabstop = state.tabstop ?? 8;

    if (state.viewportTop !== undefined) {
      viewportTop = Math.max(0, Math.min(state.viewportTop, Math.max(0, totalLines - VIM_ROWS)));
    }
    if (cursorLine < viewportTop) {
      viewportTop = cursorLine;
    } else if (cursorLine >= viewportTop + VIM_ROWS) {
      viewportTop = cursorLine - VIM_ROWS + 1;
    }

    const gutterWidth = Math.max(String(totalLines).length, String(viewportTop + VIM_ROWS).length);
    const gutterLines: string[] = [];
    const contentLines: string[] = [];

    for (let i = 0; i < VIM_ROWS; i++) {
      const lineIdx = viewportTop + i;
      if (lineIdx < totalLines) {
        const lineNum = String(lineIdx + 1).padStart(gutterWidth, " ");
        gutterLines.push(lineNum);

        const lineText = listMode
          ? renderListLine(lines[lineIdx], tabstop)
          : (escapeHtml(lines[lineIdx]) || " ");
        let cls = "vim-line";
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

  function renderStatusBar(state: VimState): void {
    let modeText = state.mode.toUpperCase();
    if (state.mode === "command-line") modeText = "COMMAND";
    els.mode.textContent = "-- " + modeText + " --";

    els.mode.className = "vim-mode";
    if (state.mode === "insert") els.mode.classList.add("vim-mode--insert");
    else if (state.mode === "command-line") els.mode.classList.add("vim-mode--command");

    let info = state.filePath || "";
    if (state.modified) info += " [+]";
    info += "  " + state.totalLines + "L";
    els.fileinfo.textContent = info;

    const col = state.cursorCol !== undefined ? state.cursorCol + 1 : 1;
    els.position.textContent = (state.cursorLine + 1) + "," + col;
  }

  function renderCommandRow(state: VimState): void {
    const input = els.commandInput as HTMLInputElement;
    if (state.mode === "command-line" && state.commandBuffer) {
      els.commandPrefix.textContent = ":";
      input.value = state.commandBuffer;
    } else if (lastCommandOutput) {
      els.commandPrefix.textContent = "";
      input.value = "";
      input.placeholder = lastCommandOutput;
    } else {
      els.commandPrefix.textContent = "";
      input.value = "";
      input.placeholder = "";
    }
  }

  function setCommandOutput(output: string): void {
    lastCommandOutput = output || "";
    if (lastState) {
      renderCommandRow(lastState);
    }
  }

  return {
    init,
    toggle,
    show,
    updateState,
    setCommandOutput,
    isVisible: () => visible,
    rows: () => VIM_ROWS,
    cols: () => VIM_COLS,
  };
}

export function initVimView(getVscode: () => VscodeApi): VimViewApi {
  const api = createVimView(getVscode);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => api.init());
  } else {
    api.init();
  }
  return api;
}
