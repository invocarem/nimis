/**
 * Bench tab – test selection, progress, and run controls.
 */

import type { VscodeApi } from "./vimView";

interface BenchTest {
  id: string;
}

interface BenchResult {
  id: string;
  success: boolean;
  durationMs: number;
  error?: string;
}

interface BenchProgressData {
  phase: string;
  totalTests?: number;
  testIndex?: number;
  testId?: string;
  status?: string;
  elapsedMs?: number;
  results?: BenchResult[];
}

function createBench(getVscode: () => VscodeApi) {
  let elapsedInterval: ReturnType<typeof setInterval> | null = null;
  let tests: BenchTest[] = [];

  const els: Record<string, HTMLElement | null> = {};

  function init(): void {
    els.status = document.getElementById("bench-status");
    els.log = document.getElementById("bench-log");
    els.progressArea = document.getElementById("bench-progress-area");
    els.progressFill = document.getElementById("bench-progress-fill");
    els.elapsed = document.getElementById("bench-elapsed");
    els.idleStatus = document.getElementById("bench-idle-status");
    els.runAllBtn = document.getElementById("bench-run-all");
    els.runTestBtn = document.getElementById("bench-run-test");
    els.cancelBtn = document.getElementById("bench-cancel");
    els.testsList = document.getElementById("bench-tests-list");
    els.testsSection = document.getElementById("bench-tests-section");
    els.testsOkBtn = document.getElementById("bench-tests-ok");
    els.testsCancelBtn = document.getElementById("bench-tests-cancel");

    els.runAllBtn?.addEventListener("click", () => {
      getVscode().postMessage({ type: "runBench" });
    });
    els.runTestBtn?.addEventListener("click", showTestsSection);
    els.testsOkBtn?.addEventListener("click", () => {
      const ids = getSelectedTestIds();
      hideTestsSection();
      getVscode().postMessage({ type: "runBenchSelected", testIds: ids });
    });
    els.testsCancelBtn?.addEventListener("click", hideTestsSection);
    els.cancelBtn?.addEventListener("click", () => {
      getVscode().postMessage({ type: "cancelBench" });
    });
  }

  function showTestsSection(): void {
    if (els.testsSection) {
      els.testsSection.style.display = "flex";
      getVscode().postMessage({ type: "requestBenchConfig" });
    }
  }

  function hideTestsSection(): void {
    if (els.testsSection) {
      els.testsSection.style.display = "none";
    }
  }

  function getSelectedTestIds(): string[] {
    if (!els.testsList) return [];
    const checkboxes = els.testsList.querySelectorAll(".bench-test-item input[type=checkbox]:checked");
    return Array.prototype.map.call(checkboxes, (cb: HTMLInputElement) => cb.value) as string[];
  }

  function renderTests(testsData: BenchTest[]): void {
    tests = testsData || [];
    const list = els.testsList;
    if (!list) return;
    list.innerHTML = "";
    if (tests.length === 0) {
      const empty = document.createElement("div");
      empty.className = "bench-tests-empty";
      empty.textContent = "No bench configured. Set nimis.benchPath or nimis.bench in settings.";
      list.appendChild(empty);
      return;
    }
    tests.forEach((t) => {
      const item = document.createElement("div");
      item.className = "bench-test-item";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = t.id;
      cb.id = "bench-test-" + t.id;
      const label = document.createElement("label");
      label.htmlFor = cb.id;
      label.className = "bench-test-id";
      label.textContent = t.id;
      item.addEventListener("click", (e) => {
        if (e.target !== cb) {
          cb.checked = !cb.checked;
        }
      });
      item.appendChild(cb);
      item.appendChild(label);
      list.appendChild(item);
    });
  }

  function startElapsedTimer(): void {
    const start = Date.now();
    if (elapsedInterval) clearInterval(elapsedInterval);
    elapsedInterval = setInterval(() => {
      if (els.elapsed) {
        const sec = Math.floor((Date.now() - start) / 1000);
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        els.elapsed.textContent = m + ":" + (s < 10 ? "0" : "") + s;
      }
    }, 500);
  }

  function stopElapsedTimer(): void {
    if (elapsedInterval) {
      clearInterval(elapsedInterval);
      elapsedInterval = null;
    }
  }

  function showRunning(show: boolean): void {
    if (els.progressArea) els.progressArea.style.display = show ? "block" : "none";
    if (els.idleStatus) els.idleStatus.style.display = show ? "none" : "block";
    if (els.cancelBtn) els.cancelBtn.style.display = show ? "inline-block" : "none";
    const runAll = els.runAllBtn as HTMLButtonElement | null;
    const runTest = els.runTestBtn as HTMLButtonElement | null;
    if (runAll) runAll.disabled = show;
    if (runTest) runTest.disabled = show;
  }

  function setProgressBar(percent: number | null): void {
    if (!els.progressFill) return;
    els.progressFill.classList.remove("indeterminate");
    els.progressFill.style.width = (percent != null ? percent : 0) + "%";
  }

  function setProgressIndeterminate(): void {
    els.progressFill?.classList.add("indeterminate");
  }

  function handleProgress(data: BenchProgressData): void {
    const status = els.status;
    const log = els.log;
    if (!status || !log) return;
    if (data.phase === "start") {
      showRunning(true);
      setProgressIndeterminate();
      startElapsedTimer();
      status.textContent = "Bench starting...";
      if (els.elapsed) els.elapsed.textContent = "0:00";
      log.textContent = "";
      const benchTabBtn = document.querySelector('.tab-btn[data-tab="bench"]');
      if (benchTabBtn) (benchTabBtn as HTMLElement).click();
    } else if (data.phase === "testStart") {
      const total = data.totalTests || 1;
      const idx = data.testIndex || 0;
      const pct = total > 0 ? ((idx - 1) / total) * 100 : 0;
      setProgressBar(pct);
      status.textContent = "Running: " + (data.testId || "?") + " (" + idx + "/" + total + ")";
      log.textContent += "[" + idx + "/" + total + "] " + (data.testId || "?") + "\n";
    } else if (data.phase === "progress") {
      setProgressIndeterminate();
      status.textContent = (data.testId || "?") + " – " + (data.status || "...");
      if (els.elapsed && data.elapsedMs != null) {
        const sec = Math.floor(data.elapsedMs / 1000);
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        els.elapsed.textContent = m + ":" + (s < 10 ? "0" : "") + s;
      }
      if (data.status) {
        log.textContent += "  " + data.status + "\n";
      }
    } else if (data.phase === "testComplete") {
      const total = data.totalTests || 1;
      const idx = data.testIndex || 0;
      const pct = total > 0 ? (idx / total) * 100 : 100;
      setProgressBar(pct);
      const result = (data as { result?: BenchResult }).result;
      const s = result?.success ? "PASS" : "FAIL";
      const dur = result ? (result.durationMs / 1000).toFixed(2) + "s" : "?";
      log.textContent += "  " + s + "  " + dur + "\n";
      if (result?.error) {
        log.textContent += "    " + result.error + "\n";
      }
    } else if (data.phase === "complete") {
      setProgressBar(100);
      stopElapsedTimer();
      showRunning(false);
      const results = data.results || [];
      const passed = results.filter((r) => r.success).length;
      const total = results.length;
      status.textContent = "Done: " + passed + "/" + total + " passed";
      if (els.idleStatus) els.idleStatus.textContent = "Done: " + passed + "/" + total + " passed. Click Run All or Run Test to run again.";
      log.textContent += "\nSummary: " + passed + "/" + total + " passed\n";
      results.forEach((r) => {
        log.textContent += "  " + (r.success ? "PASS" : "FAIL") + "  " + r.id + "\n";
      });
    }
    log.scrollTop = log.scrollHeight;
  }

  function handleMessage(message: { type: string; tests?: BenchTest[] } & BenchProgressData): void {
    if (message.type === "benchProgress") {
      handleProgress(message);
    } else if (message.type === "benchConfig") {
      renderTests(message.tests || []);
    }
  }

  return {
    init,
    hideTestsSection,
    handleMessage,
  };
}

export function initBench(getVscode: () => VscodeApi): ReturnType<typeof createBench> {
  const api = createBench(getVscode);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => api.init());
  } else {
    api.init();
  }
  return api;
}
