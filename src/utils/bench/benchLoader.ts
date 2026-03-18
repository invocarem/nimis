import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import type { BenchConfig, BenchTest } from "./types";

/**
 * Resolve path: expand ~ and resolve relative to baseDir.
 */
function resolvePath(p: string, baseDir: string): string {
  let expanded = p;
  if (p.startsWith("~/") || p === "~") {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    expanded = p.replace("~", home);
  }
  if (!path.isAbsolute(expanded)) {
    expanded = path.resolve(baseDir, expanded);
  }
  return path.normalize(expanded);
}

/**
 * Load bench config from settings (nimis.benchPath or nimis.bench).
 * Returns null if neither is configured or file is missing.
 */
export function loadBenchConfig(): { config: BenchConfig; benchDir: string } | null {
  const config = vscode.workspace.getConfiguration("nimis");
  const benchPath = config.get<string>("benchPath", "");
  const benchInline = config.get<BenchConfig | null>("bench", null);

  if (benchPath && benchPath.trim()) {
    const expanded = benchPath.startsWith("~/") || benchPath === "~"
      ? benchPath.replace("~", process.env.HOME || process.env.USERPROFILE || "")
      : benchPath;
    const resolved = path.resolve(expanded);
    const benchDir = path.dirname(resolved);

    if (!fs.existsSync(resolved)) {
      return null;
    }

    try {
      const content = fs.readFileSync(resolved, "utf-8");
      const raw = JSON.parse(content) as BenchConfig;
      if (!raw.tests || !Array.isArray(raw.tests)) {
        return null;
      }

      const tests: BenchTest[] = raw.tests.map((t) => ({
        id: t.id,
        promptPath: resolvePath(t.promptPath, benchDir),
        outputPath: resolvePath(t.outputPath, benchDir),
        expectedPath: t.expectedPath ? resolvePath(t.expectedPath, benchDir) : undefined,
        timeout: t.timeout ?? raw.defaults?.timeout,
        dependencies: t.dependencies,
        testCommand: t.testCommand,
      }));

      return {
        config: { tests, defaults: raw.defaults },
        benchDir,
      };
    } catch {
      return null;
    }
  }

  if (benchInline && benchInline.tests && Array.isArray(benchInline.tests)) {
    const baseDir = process.cwd();
    const tests: BenchTest[] = benchInline.tests.map((t) => ({
      id: t.id,
      promptPath: resolvePath(t.promptPath, baseDir),
      outputPath: resolvePath(t.outputPath, baseDir),
      expectedPath: t.expectedPath ? resolvePath(t.expectedPath, baseDir) : undefined,
      timeout: t.timeout ?? benchInline.defaults?.timeout,
      dependencies: t.dependencies,
      testCommand: t.testCommand,
    }));
    return {
      config: { tests, defaults: benchInline.defaults },
      benchDir: baseDir,
    };
  }

  return null;
}
