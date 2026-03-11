/**
 * Bench tab – test selection, progress, and run controls.
 * Loaded after main.js. Uses global vscode from main.js.
 */

var Bench = (function () {
  var elapsedInterval = null;
  var tests = [];

  var els = {};

  function init() {
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

    if (els.runAllBtn) {
      els.runAllBtn.addEventListener("click", function () {
        vscode.postMessage({ type: "runBench" });
      });
    }
    if (els.runTestBtn) {
      els.runTestBtn.addEventListener("click", showTestsSection);
    }
    if (els.testsOkBtn) {
      els.testsOkBtn.addEventListener("click", function () {
        var ids = getSelectedTestIds();
        hideTestsSection();
        vscode.postMessage({ type: "runBenchSelected", testIds: ids });
      });
    }
    if (els.testsCancelBtn) {
      els.testsCancelBtn.addEventListener("click", hideTestsSection);
    }
    if (els.cancelBtn) {
      els.cancelBtn.addEventListener("click", function () {
        vscode.postMessage({ type: "cancelBench" });
      });
    }
  }

  function showTestsSection() {
    if (els.testsSection) {
      els.testsSection.style.display = "flex";
      vscode.postMessage({ type: "requestBenchConfig" });
    }
  }

  function hideTestsSection() {
    if (els.testsSection) {
      els.testsSection.style.display = "none";
    }
  }

  function getSelectedTestIds() {
    if (!els.testsList) return [];
    var checkboxes = els.testsList.querySelectorAll(".bench-test-item input[type=checkbox]:checked");
    return Array.prototype.map.call(checkboxes, function (cb) { return cb.value; });
  }

  function renderTests(testsData) {
    tests = testsData || [];
    if (!els.testsList) return;
    els.testsList.innerHTML = "";
    if (tests.length === 0) {
      var empty = document.createElement("div");
      empty.className = "bench-tests-empty";
      empty.textContent = "No bench configured. Set nimis.benchPath or nimis.bench in settings.";
      els.testsList.appendChild(empty);
      return;
    }
    tests.forEach(function (t) {
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
      els.testsList.appendChild(item);
    });
  }

  function startElapsedTimer() {
    var start = Date.now();
    if (elapsedInterval) clearInterval(elapsedInterval);
    elapsedInterval = setInterval(function () {
      if (els.elapsed) {
        var sec = Math.floor((Date.now() - start) / 1000);
        var m = Math.floor(sec / 60);
        var s = sec % 60;
        els.elapsed.textContent = m + ":" + (s < 10 ? "0" : "") + s;
      }
    }, 500);
  }

  function stopElapsedTimer() {
    if (elapsedInterval) {
      clearInterval(elapsedInterval);
      elapsedInterval = null;
    }
  }

  function showRunning(show) {
    if (els.progressArea) els.progressArea.style.display = show ? "block" : "none";
    if (els.idleStatus) els.idleStatus.style.display = show ? "none" : "block";
    if (els.cancelBtn) els.cancelBtn.style.display = show ? "inline-block" : "none";
    if (els.runAllBtn) els.runAllBtn.disabled = show;
    if (els.runTestBtn) els.runTestBtn.disabled = show;
  }

  function setProgressBar(percent) {
    if (!els.progressFill) return;
    els.progressFill.classList.remove("indeterminate");
    els.progressFill.style.width = (percent != null ? percent : 0) + "%";
  }

  function setProgressIndeterminate() {
    if (!els.progressFill) return;
    els.progressFill.classList.add("indeterminate");
  }

  function handleProgress(data) {
    if (!els.status || !els.log) return;
    if (data.phase === "start") {
      showRunning(true);
      setProgressIndeterminate();
      startElapsedTimer();
      els.status.textContent = "Bench starting...";
      if (els.elapsed) els.elapsed.textContent = "0:00";
      els.log.textContent = "";
      var benchTabBtn = document.querySelector('.tab-btn[data-tab="bench"]');
      if (benchTabBtn) benchTabBtn.click();
    } else if (data.phase === "testStart") {
      var total = data.totalTests || 1;
      var idx = data.testIndex || 0;
      var pct = total > 0 ? ((idx - 1) / total) * 100 : 0;
      setProgressBar(pct);
      els.status.textContent = "Running: " + (data.testId || "?") + " (" + idx + "/" + total + ")";
      els.log.textContent += "[" + idx + "/" + total + "] " + (data.testId || "?") + "\n";
    } else if (data.phase === "progress") {
      setProgressIndeterminate();
      els.status.textContent = (data.testId || "?") + " – " + (data.status || "...");
      if (els.elapsed && data.elapsedMs != null) {
        var sec = Math.floor(data.elapsedMs / 1000);
        var m = Math.floor(sec / 60);
        var s = sec % 60;
        els.elapsed.textContent = m + ":" + (s < 10 ? "0" : "") + s;
      }
      if (data.status) {
        els.log.textContent += "  " + data.status + "\n";
      }
    } else if (data.phase === "testComplete") {
      var total = data.totalTests || 1;
      var idx = data.testIndex || 0;
      var pct = total > 0 ? (idx / total) * 100 : 100;
      setProgressBar(pct);
      var r = data.result;
      var s = r && r.success ? "PASS" : "FAIL";
      var dur = r ? (r.durationMs / 1000).toFixed(2) + "s" : "?";
      els.log.textContent += "  " + s + "  " + dur + "\n";
      if (r && r.error) {
        els.log.textContent += "    " + r.error + "\n";
      }
    } else if (data.phase === "complete") {
      setProgressBar(100);
      stopElapsedTimer();
      showRunning(false);
      var results = data.results || [];
      var passed = results.filter(function (r) { return r.success; }).length;
      var total = results.length;
      els.status.textContent = "Done: " + passed + "/" + total + " passed";
      if (els.idleStatus) els.idleStatus.textContent = "Done: " + passed + "/" + total + " passed. Click Run All or Run Test to run again.";
      els.log.textContent += "\nSummary: " + passed + "/" + total + " passed\n";
      results.forEach(function (r) {
        els.log.textContent += "  " + (r.success ? "PASS" : "FAIL") + "  " + r.id + "\n";
      });
    }
    els.log.scrollTop = els.log.scrollHeight;
  }

  function handleMessage(message) {
    if (message.type === "benchProgress") {
      handleProgress(message);
    } else if (message.type === "benchConfig") {
      renderTests(message.tests);
    }
  }

  return {
    init: init,
    hideTestsSection: hideTestsSection,
    handleMessage: handleMessage,
  };
})();

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", function () {
    Bench.init();
  });
} else {
  Bench.init();
}
