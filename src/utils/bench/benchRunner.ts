import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { ILLMClient } from "../../api/llmClient";
import { LlamaClient } from "../../api/llamaClient";
import { VLLMClient } from "../../api/vllmClient";
import { MistralClient } from "../../api/mistralClient";
import { NimisManager } from "../nimisManager";
import { toolExecutor } from "../../toolExecutor";
import { ResponseParser, ParsedResponse } from "../responseParser";
import { NimisStateTracker, TOOL_CALL_LIMIT_PER_TURN } from "../nimisStateTracker";
import { VimToolManager } from "../vim";
import { NativeToolsManager } from "../nativeToolManager";
import type { MCPManager } from "../../mcpManager";
import type { BenchTest, BenchResult, BenchProgressEvent } from "./types";
import { loadBenchConfig } from "./benchLoader";

function toAbortSignal(token?: vscode.CancellationToken): AbortSignal | undefined {
  if (!token) return undefined;
  const ctrl = new AbortController();
  token.onCancellationRequested(() => ctrl.abort());
  return ctrl.signal;
}

const BENCH_SYSTEM_SUFFIX = `

## Bench mode (autonomous)
You are running in autonomous bench mode. There is no human to interact with.
- Solve the problem described below.
- Save your solution to the specified output path using :e and :w (or create_file).
- Do NOT ask for confirmation or approval. Execute :w when done.
- Put only the solution code in the output file—no explanations.
`;

const BENCH_PATCH_SYSTEM_SUFFIX = `

## Patch mode (unified diff)
- Your task is to generate a unified diff patch (hunks starting with @@).
- The runner will apply the patch to the provided input code to produce the final output file.
- Save ONLY the patch content to the specified patch file (no explanations, no markdown fences).
`;

function createLLMClient(): ILLMClient | null {
  const config = vscode.workspace.getConfiguration("nimis");
  const serverType = config.get<string>("serverType", "llama");

  if (serverType === "mistral") {
    const apiKey = config.get<string>("apiKey", "");
    const model = config.get<string>("model", "mistral-medium-2508");
    return new MistralClient(apiKey, model);
  }

  const defaultUrl =
    serverType === "vllm" ? "http://localhost:8000" : "http://localhost:8080";
  const serverUrl = config.get<string>("serverUrl") || defaultUrl;

  if (serverType === "vllm") {
    const model = config.get<string>("model", "default");
    return new VLLMClient(serverUrl, model);
  }
  return new LlamaClient(serverUrl);
}

function buildUserMessage(problemContent: string, outputPath: string): string {
  return `${problemContent}

---
Save your solution to: ${outputPath}
Use :e to open/create the file, write your solution, then :w to save.`;
}

function buildPatchUserMessage(
  problemContent: string,
  inputCode: string,
  inputPath: string,
  outputPath: string,
  patchPath: string,
  failureFeedback?: string
): string {
  return `${problemContent}

---
You are generating a patch.

Input code is currently here:
${inputPath}

Output will be written to:
${outputPath}

You must write ONLY a unified diff patch (hunks starting with @@) to:
${patchPath}

Patch application rules:
- The patch will be applied to the exact input code shown below.
- Your hunks must include correct @@ -<start> +<start> @@ headers.
- The patch must transform the input into a correct solution so that testCommand passes.
- Do NOT include markdown code fences.
- Do NOT include explanations—patch hunks only.
- Include context lines (lines prefixed with a single space in unified diff) when possible.

INPUT CODE:
${inputCode}

${failureFeedback ? `---
Previous attempt failed:
${failureFeedback}

Regenerate a corrected patch.` : ""}

---
Save your patch to: ${patchPath}
Use :e to open/create the file, write ONLY the patch hunks, then :w to save.`;
}

/**
 * Apply a (single-file) unified diff patch to the provided input text.
 *
 * Notes:
 * - This supports hunks with context lines (' ') and removals ('-') and additions ('+').
 * - It ignores diff headers ('---', '+++', 'diff --git') and "\ No newline..." lines.
 * - Hunk ordering must be consistent and non-overlapping.
 */
export function applyUnifiedDiffPatch(inputText: string, patchText: string): string {
  const newlineSeq = inputText.includes("\r\n") ? "\r\n" : "\n";
  const originalEndsWithNewline = /\r?\n$/.test(inputText);
  const originalNormalized = inputText.replace(/\r\n/g, "\n");
  const originalLines = originalNormalized.split("\n");

  const sanitizedPatch = patchText
    .split(/\r?\n/)
    .filter((l) => !l.trimStart().startsWith("```"))
    .join("\n");

  const patchLines = sanitizedPatch.split("\n");

  type Hunk = {
    origStart: number; // 0-based
    lines: string[]; // raw diff lines for this hunk, including leading ' ', '+', '-'
  };

  const hunks: Hunk[] = [];

  let i = 0;
  while (i < patchLines.length) {
    const line = patchLines[i];
    const headerMatch = line.match(
      /^@@\s*-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s*@@/
    );
    if (!headerMatch) {
      i++;
      continue;
    }

    const origStart = parseInt(headerMatch[1], 10) - 1;
    i++; // consume header

    const hunkLines: string[] = [];
    while (i < patchLines.length) {
      const l = patchLines[i];
      if (l.match(/^@@\s*-/)) break;
      // stop only at next hunk header; keep other lines out
      hunkLines.push(l);
      i++;
    }

    hunks.push({ origStart, lines: hunkLines });
  }

  if (hunks.length === 0) {
    throw new Error("Patch does not contain any @@ hunks");
  }

  const outLines: string[] = [];
  let cursor = 0; // index in originalLines

  for (const hunk of hunks) {
    const targetIndex = hunk.origStart;
    if (targetIndex < cursor) {
      throw new Error(
        `Patch hunks are overlapping or out of order (targetIndex=${targetIndex}, cursor=${cursor})`
      );
    }

    outLines.push(...originalLines.slice(cursor, targetIndex));
    cursor = targetIndex;

    for (const raw of hunk.lines) {
      if (!raw) continue;
      if (raw.startsWith("\\")) continue; // e.g. "\ No newline at end of file"
      const sign = raw[0];
      if (sign !== " " && sign !== "+" && sign !== "-") {
        // tolerate noise lines inside the hunk by skipping them
        continue;
      }
      const payload = raw.slice(1);

      if (sign === " ") {
        const expected = payload;
        if (originalLines[cursor] !== expected) {
          throw new Error(
            `Patch context mismatch at line ${cursor + 1}: expected "${expected}", got "${originalLines[cursor]}"`
          );
        }
        outLines.push(expected);
        cursor++;
      } else if (sign === "-") {
        const expected = payload;
        if (originalLines[cursor] !== expected) {
          throw new Error(
            `Patch removal mismatch at line ${cursor + 1}: expected "${expected}", got "${originalLines[cursor]}"`
          );
        }
        cursor++;
      } else if (sign === "+") {
        outLines.push(payload);
      }
    }
  }

  outLines.push(...originalLines.slice(cursor));

  const patchedNormalized = outLines.join("\n");
  // Preserve final newline if the input had one.
  const patchedWithFinalNewline =
    originalEndsWithNewline && !patchedNormalized.endsWith("\n")
      ? patchedNormalized + "\n"
      : patchedNormalized;

  return patchedWithFinalNewline.replace(/\n/g, newlineSeq);
}

function ensureParentDirForFile(filePath: string): void {
  const parent = path.dirname(filePath);
  fs.mkdirSync(parent, { recursive: true });
}

function readFileUtf8OrEmpty(filePath: string): string {
  try {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : "";
  } catch {
    return "";
  }
}

function createStreamWriter(outputChannel: vscode.OutputChannel, testId: string) {
  let started = false;
  return {
    write(chunk: string) {
      if (!chunk) return;
      if (!started) {
        outputChannel.appendLine(`  [${testId}] LLM stream start`);
        started = true;
      }
      outputChannel.append(chunk);
    },
    end() {
      if (!started) return;
      outputChannel.appendLine("");
      outputChannel.appendLine(`  [${testId}] LLM stream end`);
    },
  };
}

/**
 * Run a single bench test.
 */
export async function runSingleTest(
  test: BenchTest,
  benchDir: string,
  llmClient: ILLMClient,
  mcpManager: MCPManager | undefined,
  outputChannel: vscode.OutputChannel,
  cancellationToken?: vscode.CancellationToken,
  onProgress?: (event: BenchProgressEvent) => void
): Promise<BenchResult> {
  const start = Date.now();
  const timeout = test.timeout ?? 120_000;

  if (!fs.existsSync(test.promptPath)) {
    return {
      id: test.id,
      success: false,
      durationMs: Date.now() - start,
      error: `Prompt file not found: ${test.promptPath}`,
    };
  }

  const problemContent = fs.readFileSync(test.promptPath, "utf-8");
  const isPatchMode = !!test.patchPath;

  if (isPatchMode) {
    return await (async () => {
      if (!test.inputPath || !test.patchPath) {
        return {
          id: test.id,
          success: false,
          durationMs: Date.now() - start,
          error: "patchPath mode requires both inputPath and patchPath",
        };
      }

      if (!fs.existsSync(test.inputPath)) {
        return {
          id: test.id,
          success: false,
          durationMs: Date.now() - start,
          error: `Input file not found: ${test.inputPath}`,
        };
      }

      const inputCode = fs.readFileSync(test.inputPath, "utf-8");
      const maxIterations = test.maxFixIterations ?? 3;
      const patchTimeoutDeadline = Date.now() + timeout;

      ensureParentDirForFile(test.patchPath);
      ensureParentDirForFile(test.outputPath);

      // Ensure output is not “reused” from a previous run.
      if (fs.existsSync(test.outputPath)) {
        try {
          fs.unlinkSync(test.outputPath);
        } catch {
          // ignore: apply step will overwrite on success
        }
      }

      const config = vscode.workspace.getConfiguration("nimis");
      const temperature = config.get<number>("temperature", 0.7);
      const maxTokens = config.get<number>("maxTokens", 2048);

      let failureFeedback: string | undefined = undefined;
      for (let iter = 0; iter < maxIterations; iter++) {
        if (cancellationToken?.isCancellationRequested) break;
        if (Date.now() > patchTimeoutDeadline) {
          return {
            id: test.id,
            success: false,
            durationMs: Date.now() - start,
            error: "Timeout",
          };
        }

        // Avoid accidentally re-applying a previous patch if the LLM fails to overwrite this file.
        try {
          if (fs.existsSync(test.patchPath)) fs.unlinkSync(test.patchPath);
        } catch {
          // ignore
        }

        const patchUserMessage = buildPatchUserMessage(
          problemContent,
          inputCode,
          test.inputPath,
          test.outputPath,
          test.patchPath,
          failureFeedback
        );

        const benchStateTracker = new NimisStateTracker({
          workspaceRoot: benchDir,
          persistPath: undefined,
        });
        const nimisManager = new NimisManager({
          mcpManager,
          vimToolManager: VimToolManager.getInstance(),
          rulesManager: undefined,
          workspaceRoot: benchDir,
          stateTracker: benchStateTracker,
        });

        const baseTemplate = nimisManager.getTemplate();
        nimisManager.updateTemplate({
          systemMessage: baseTemplate.systemMessage + BENCH_SYSTEM_SUFFIX + BENCH_PATCH_SYSTEM_SUFFIX,
        });

        const stateTracker = nimisManager.getStateTracker();
        stateTracker.setProblem(patchUserMessage);

        const conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = [
          { role: "user", content: patchUserMessage },
        ];

        let continueLoop = true;
        try {
          stateTracker.startNewTurn();
          onProgress?.({
            phase: "testStart",
            testId: test.id,
            elapsedMs: Date.now() - start,
          });

          while (continueLoop) {
            if (cancellationToken?.isCancellationRequested) break;
            if (Date.now() > patchTimeoutDeadline) {
              return {
                id: test.id,
                success: false,
                durationMs: Date.now() - start,
                error: "Timeout",
              };
            }

            const prompt = nimisManager.buildConversationPrompt(conversationHistory);
            let fullResponse = "";
            const streamWriter = createStreamWriter(outputChannel, test.id);

            onProgress?.({
              phase: "progress",
              testId: test.id,
              status: `Streaming LLM response... (patch iter ${iter + 1}/${maxIterations})`,
              elapsedMs: Date.now() - start,
            });

            await llmClient.streamComplete(
              {
                prompt,
                temperature,
                maxTokens,
                stop: ["User:", "\nUser:", "Human:", "\nHuman:"],
              },
              (chunk: string) => {
                fullResponse += chunk;
                streamWriter.write(chunk);
              },
              toAbortSignal(cancellationToken)
            );
            streamWriter.end();

            const parsedResponse: ParsedResponse = ResponseParser.parse(fullResponse);

            if (ResponseParser.hasToolCalls(parsedResponse)) {
              const toolCalls = ResponseParser.getAllToolCalls(parsedResponse);

              if (stateTracker.hasReachedToolCallLimit()) {
                outputChannel.appendLine(`  [${test.id}] Tool call limit reached`);
                continueLoop = false;
                break;
              }

              const allToolResults: string[] = [];
              let hasError = false;

              for (const toolCall of toolCalls) {
                if (cancellationToken?.isCancellationRequested) break;

                stateTracker.recordToolCall(toolCall.name, toolCall.arguments);

                onProgress?.({
                  phase: "progress",
                  testId: test.id,
                  status: `Executing tool: ${toolCall.name}`,
                  elapsedMs: Date.now() - start,
                });

                try {
                  const toolResult = await toolExecutor(toolCall, {
                    mcpManager,
                    vimToolManager: VimToolManager.getInstance(),
                  });

                  const toolText =
                    toolResult.content?.map((c) => c.text).join("\n") ||
                    JSON.stringify(toolResult);

                  allToolResults.push(toolText);

                  stateTracker.updateLastToolCallResult({
                    success: !toolResult.isError,
                    summary: toolText.length > 200 ? toolText.substring(0, 200) + "..." : toolText,
                  });

                  const filePath =
                    (toolCall.arguments?.file_path ?? toolCall.arguments?.filePath) as string | undefined;
                  if (filePath) {
                    stateTracker.setCurrentFile(filePath);
                  }

                  if (toolResult.isError) {
                    hasError = true;
                    break;
                  }
                } catch (err: unknown) {
                  const msg = err instanceof Error ? err.message : String(err);
                  allToolResults.push(`Tool execution error: ${msg}`);
                  stateTracker.updateLastToolCallResult({ success: false, summary: msg });
                  hasError = true;
                  break;
                }
              }

              if (allToolResults.length > 0) {
                conversationHistory.push({ role: "assistant", content: parsedResponse.raw });
                conversationHistory.push({ role: "user", content: allToolResults.join("\n\n") });
              } else {
                continueLoop = false;
              }

              if (hasError) {
                // Let the outer loop regenerate a new patch.
                failureFeedback = `Tool execution error while generating patch (iter ${iter + 1}).`;
                break;
              }
            } else {
              conversationHistory.push({ role: "assistant", content: parsedResponse.raw });
              continueLoop = false;
            }
          }

          const patchExists = fs.existsSync(test.patchPath);
          if (!patchExists) {
            failureFeedback = `Patch file was not created: ${test.patchPath}`;
            continue;
          }

          const patchText = readFileUtf8OrEmpty(test.patchPath);
          if (!patchText.trim()) {
            failureFeedback = `Patch file is empty: ${test.patchPath}`;
            continue;
          }

          let patchedCode: string;
          try {
            patchedCode = applyUnifiedDiffPatch(inputCode, patchText);
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            failureFeedback = `Patch apply failed: ${msg}`;
            continue;
          }

          fs.writeFileSync(test.outputPath, patchedCode, "utf-8");

          let success = fs.existsSync(test.outputPath);
          let error: string | undefined = success ? undefined : "Output file was not created";

          if (success && test.testCommand) {
            onProgress?.({
              phase: "progress",
              testId: test.id,
              status: `Running test command: ${test.testCommand} (iter ${iter + 1}/${maxIterations})`,
              elapsedMs: Date.now() - start,
            });
            const nativeMgr = NativeToolsManager.getInstance();
            const toolResult = await nativeMgr.executeCommand(test.testCommand, benchDir);
            if (toolResult.isError) {
              success = false;
              const output =
                toolResult.content?.map((c) => c.text).join("\n") || "Test command failed";
              error = `Test command failed: ${output}`;
              failureFeedback = error;
            }
          }

          const durationMs = Date.now() - start;
          const result: BenchResult = {
            id: test.id,
            success,
            durationMs,
            outputPath: test.outputPath,
            outputExists: success,
            error,
          };
          onProgress?.({ phase: "testComplete", testId: test.id, result, elapsedMs: durationMs });

          if (success) {
            return result;
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          failureFeedback = `Patch workflow crashed: ${msg}`;
        }
      }

      const durationMs = Date.now() - start;
      return {
        id: test.id,
        success: false,
        durationMs,
        outputPath: test.outputPath,
        outputExists: fs.existsSync(test.outputPath),
        error: failureFeedback ? `Patch mode failed: ${failureFeedback}` : "Patch mode failed",
      };
    })();
  }

  const userMessage = buildUserMessage(problemContent, test.outputPath);

  const benchStateTracker = new NimisStateTracker({
    workspaceRoot: benchDir,
    persistPath: undefined,
  });
  const nimisManager = new NimisManager({
    mcpManager,
    vimToolManager: VimToolManager.getInstance(),
    rulesManager: undefined,
    workspaceRoot: benchDir,
    stateTracker: benchStateTracker,
  });

  const baseTemplate = nimisManager.getTemplate();
  nimisManager.updateTemplate({
    systemMessage: baseTemplate.systemMessage + BENCH_SYSTEM_SUFFIX,
  });

  const stateTracker = nimisManager.getStateTracker();
  stateTracker.setProblem(userMessage);

  const conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = [
    { role: "user", content: userMessage },
  ];

  const config = vscode.workspace.getConfiguration("nimis");
  const temperature = config.get<number>("temperature", 0.7);
  const maxTokens = config.get<number>("maxTokens", 2048);

  let continueLoop = true;
  const deadline = Date.now() + timeout;

  try {
    stateTracker.startNewTurn();
    onProgress?.({
      phase: "testStart",
      testId: test.id,
      elapsedMs: Date.now() - start,
    });

    while (continueLoop) {
      if (cancellationToken?.isCancellationRequested) {
        break;
      }
      if (Date.now() > deadline) {
        outputChannel.appendLine(`  [${test.id}] Timeout after ${timeout}ms`);
        return {
          id: test.id,
          success: false,
          durationMs: Date.now() - start,
          error: "Timeout",
        };
      }

      const prompt = nimisManager.buildConversationPrompt(conversationHistory);
      let fullResponse = "";
      const streamWriter = createStreamWriter(outputChannel, test.id);

      onProgress?.({
        phase: "progress",
        testId: test.id,
        status: "Streaming LLM response...",
        elapsedMs: Date.now() - start,
      });

      await llmClient.streamComplete(
        {
          prompt,
          temperature,
          maxTokens,
          stop: ["User:", "\nUser:", "Human:", "\nHuman:"],
        },
        (chunk: string) => {
          fullResponse += chunk;
          streamWriter.write(chunk);
        },
        toAbortSignal(cancellationToken)
      );
      streamWriter.end();

      const parsedResponse: ParsedResponse = ResponseParser.parse(fullResponse);

      if (ResponseParser.hasToolCalls(parsedResponse)) {
        const toolCalls = ResponseParser.getAllToolCalls(parsedResponse);

        if (stateTracker.hasReachedToolCallLimit()) {
          outputChannel.appendLine(`  [${test.id}] Tool call limit reached`);
          continueLoop = false;
          break;
        }

        const allToolResults: string[] = [];
        let hasError = false;

        for (const toolCall of toolCalls) {
          if (cancellationToken?.isCancellationRequested) break;

          stateTracker.recordToolCall(toolCall.name, toolCall.arguments);

          onProgress?.({
            phase: "progress",
            testId: test.id,
            status: `Executing tool: ${toolCall.name}`,
            elapsedMs: Date.now() - start,
          });

          try {
            const toolResult = await toolExecutor(toolCall, {
              mcpManager,
              vimToolManager: VimToolManager.getInstance(),
            });

            const toolText =
              toolResult.content?.map((c) => c.text).join("\n") ||
              JSON.stringify(toolResult);
            allToolResults.push(toolText);

            stateTracker.updateLastToolCallResult({
              success: !toolResult.isError,
              summary: toolText.length > 200 ? toolText.substring(0, 200) + "..." : toolText,
            });

            const filePath =
              (toolCall.arguments?.file_path ?? toolCall.arguments?.filePath) as string | undefined;
            if (filePath) {
              stateTracker.setCurrentFile(filePath);
            }

            if (toolResult.isError) {
              hasError = true;
              break;
            }
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            allToolResults.push(`Tool execution error: ${msg}`);
            stateTracker.updateLastToolCallResult({ success: false, summary: msg });
            hasError = true;
            break;
          }
        }

        if (allToolResults.length > 0) {
          conversationHistory.push({ role: "assistant", content: parsedResponse.raw });
          conversationHistory.push({ role: "user", content: allToolResults.join("\n\n") });
        } else {
          continueLoop = false;
        }
      } else {
        conversationHistory.push({ role: "assistant", content: parsedResponse.raw });
        continueLoop = false;
      }
    }

    const outputExists = fs.existsSync(test.outputPath);
    let success = outputExists;
    let error: string | undefined = outputExists ? undefined : "Output file was not created";

    if (outputExists && test.testCommand) {
      onProgress?.({
        phase: "progress",
        testId: test.id,
        status: `Running test command: ${test.testCommand}`,
        elapsedMs: Date.now() - start,
      });
      const nativeMgr = NativeToolsManager.getInstance();
      const toolResult = await nativeMgr.executeCommand(test.testCommand, benchDir);
      if (toolResult.isError) {
        success = false;
        const output = toolResult.content?.map((c) => c.text).join("\n") || "Test command failed";
        error = `Test command failed: ${output}`;
      }
    }

    const durationMs = Date.now() - start;
    const result: BenchResult = {
      id: test.id,
      success,
      durationMs,
      outputPath: test.outputPath,
      outputExists,
      error,
    };
    onProgress?.({ phase: "testComplete", testId: test.id, result, elapsedMs: durationMs });
    return result;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const failResult: BenchResult = {
      id: test.id,
      success: false,
      durationMs: Date.now() - start,
      error: msg,
    };
    onProgress?.({ phase: "testComplete", testId: test.id, result: failResult, elapsedMs: failResult.durationMs });
    return failResult;
  }
}

/**
 * Topologically sort tests so dependencies run before dependents.
 */
export function sortByDependencies(tests: BenchTest[]): BenchTest[] {
  const idToTest = new Map(tests.map((t) => [t.id, t]));
  const visited = new Set<string>();
  const result: BenchTest[] = [];

  function visit(id: string) {
    if (visited.has(id)) return;
    visited.add(id);
    const test = idToTest.get(id);
    if (test?.dependencies?.length) {
      for (const dep of test.dependencies) {
        if (idToTest.has(dep)) visit(dep);
      }
    }
    const t = idToTest.get(id);
    if (t) result.push(t);
  }

  for (const test of tests) {
    visit(test.id);
  }
  return result;
}

/**
 * Run all bench tests (or a subset by id).
 */
export async function runBench(
  options?: {
    testIds?: string[];
    mcpManager?: MCPManager;
    onProgress?: (event: BenchProgressEvent) => void;
  },
  cancellationToken?: vscode.CancellationToken
): Promise<BenchResult[]> {
  const loaded = loadBenchConfig();
  if (!loaded) {
    throw new Error(
      "Bench not configured. Set nimis.benchPath to a bench.json file, or nimis.bench with inline config."
    );
  }

  const { config, benchDir } = loaded;
  let tests = config.tests;
  const testIds = options?.testIds;
  if (testIds?.length) {
    const ids = new Set(testIds);
    tests = tests.filter((t) => ids.has(t.id));
  }
  tests = sortByDependencies(tests);

  const llmClient = createLLMClient();
  if (!llmClient) {
    throw new Error("LLM client not initialized. Check nimis.serverType and nimis.serverUrl.");
  }

  const outputChannel = vscode.window.createOutputChannel("Nimis Bench");
  outputChannel.show();

  const startTime = new Date().toISOString();

  outputChannel.clear();
  outputChannel.appendLine("Nimis Bench");
  outputChannel.appendLine("===========");
  outputChannel.appendLine(`Started: ${startTime}`);
  outputChannel.appendLine(`Bench dir: ${benchDir}`);
  outputChannel.appendLine(`Tests: ${tests.length}`);
  outputChannel.appendLine("");

  const nativeMgr = NativeToolsManager.getInstance();
  const vimMgr = VimToolManager.getInstance();

  nativeMgr.setWorkspaceRootProvider(() => benchDir);
  vimMgr.setWorkspaceRootProvider(() => benchDir);
  vimMgr.setWorkingDir(benchDir);

  const mcpManager = options?.mcpManager;
  const onProgress = options?.onProgress;

  const report = (event: BenchProgressEvent) => {
    onProgress?.({ ...event, testIndex: event.testIndex ?? 0, totalTests: tests.length });
  };

  report({ phase: "start" });

  try {
    const results: BenchResult[] = [];
    const resultsById = new Map<string, BenchResult>();
    for (let i = 0; i < tests.length; i++) {
      if (cancellationToken?.isCancellationRequested) break;
      const test = tests[i];
      const deps = test.dependencies ?? [];
      const failedDep = deps.find((dep) => {
        const r = resultsById.get(dep);
        return r && !r.success;
      });
      if (failedDep) {
        const skipResult: BenchResult = {
          id: test.id,
          success: false,
          durationMs: 0,
          error: `Skipped: dependency "${failedDep}" failed`,
        };
        results.push(skipResult);
        resultsById.set(test.id, skipResult);
        outputChannel.appendLine(`[${i + 1}/${tests.length}] ${test.id}`);
        outputChannel.appendLine(`  SKIP  dependency "${failedDep}" failed`);
        outputChannel.appendLine("");
        report({ phase: "testComplete", testId: test.id, result: skipResult, elapsedMs: 0 });
        continue;
      }
      outputChannel.appendLine(`[${i + 1}/${tests.length}] ${test.id}`);
      const result = await runSingleTest(
        test,
        benchDir,
        llmClient,
        mcpManager,
        outputChannel,
        cancellationToken,
        (ev) => report({ ...ev, testIndex: i + 1, totalTests: tests.length })
      );
      results.push(result);
      resultsById.set(test.id, result);
      const status = result.success ? "PASS" : "FAIL";
      const duration = `${(result.durationMs / 1000).toFixed(2)}s`;
      outputChannel.appendLine(`  ${status}  ${duration}  ${result.id}`);
      if (result.success && result.outputPath) {
        outputChannel.appendLine(`    → ${result.outputPath}`);
      }
      if (result.error) {
        outputChannel.appendLine(`    ${result.error}`);
      }
      outputChannel.appendLine("");
    }

    const passed = results.filter((r) => r.success).length;
    const total = results.length;
    const totalMs = results.reduce((s, r) => s + r.durationMs, 0);
    const totalSec = (totalMs / 1000).toFixed(2);

    outputChannel.appendLine("Summary");
    outputChannel.appendLine("-------");
    outputChannel.appendLine(`Passed: ${passed}/${total}`);
    outputChannel.appendLine(`Total time: ${totalSec}s`);
    outputChannel.appendLine("");
    results.forEach((r) => {
      const s = r.success ? "PASS" : "FAIL";
      outputChannel.appendLine(`  ${s}  ${r.id}`);
    });

    report({ phase: "complete", results });
    return results;
  } finally {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const restore = () => workspaceRoot;
    nativeMgr.setWorkspaceRootProvider(restore);
    vimMgr.setWorkspaceRootProvider(restore);
    if (workspaceRoot) {
      vimMgr.setWorkingDir(workspaceRoot);
    }
  }
}
