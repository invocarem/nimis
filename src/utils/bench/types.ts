/**
 * Bench feature types for AI benchmark tests.
 */

export interface BenchTest {
  id: string;
  promptPath: string;
  outputPath: string;
  expectedPath?: string;
  timeout?: number;
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
