/**
 * Bench feature types for AI benchmark tests.
 */

export interface BenchTest {
  id: string;
  promptPath: string;
  outputPath: string;
  /**
   * Patch workflow inputs:
   * - `inputPath` is the existing code that will be patched.
   * - `patchPath` is where the LLM must write a unified diff / patch text.
   * If `patchPath` is provided, the bench runner will treat this test as a patch test.
   */
  inputPath?: string;
  patchPath?: string;
  expectedPath?: string;
  timeout?: number;
  /** Task IDs that must succeed before this task runs. */
  dependencies?: string[];
  /** Command to run after solution is generated (e.g. pytest). Success requires this to pass. */
  testCommand?: string;
  /** Maximum iterations for patch regeneration when tests fail. */
  maxFixIterations?: number;
}

export interface BenchConfig {
  tests: BenchTest[];
  defaults?: {
    timeout?: number;
    outputDir?: string;
  };
}

export interface BenchResult {
  id: string;
  success: boolean;
  durationMs: number;
  outputPath?: string;
  error?: string;
  outputExists?: boolean;
}

export type BenchProgressPhase = "start" | "testStart" | "progress" | "testComplete" | "complete";

export interface BenchProgressEvent {
  phase: BenchProgressPhase;
  testId?: string;
  testIndex?: number;
  totalTests?: number;
  status?: string;
  elapsedMs?: number;
  result?: BenchResult;
  results?: BenchResult[];
}
