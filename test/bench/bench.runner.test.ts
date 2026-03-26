jest.mock("axios", () => ({
  create: () => ({ post: jest.fn(), get: jest.fn() }),
}));

jest.mock("vscode", () => ({
  workspace: {
    getConfiguration: jest.fn(() => ({
      get: jest.fn((key: string, defaultValue: unknown) => defaultValue),
    })),
    workspaceFolders: [{ uri: { fsPath: "/test/workspace" } }],
  },
  window: {
    createOutputChannel: jest.fn(() => ({
      appendLine: jest.fn(),
      append: jest.fn(),
    })),
  },
}));

jest.mock("../../src/utils/bench/benchLoader");

import { loadBenchConfig } from "../../src/utils/bench/benchLoader";
import * as benchRunner from "../../src/utils/bench/benchRunner";
import type { BenchTest } from "../../src/utils/bench/types";

const mockLoadBenchConfig = loadBenchConfig as jest.MockedFunction<typeof loadBenchConfig>;

describe("runBench", () => {
  beforeEach(() => {
    mockLoadBenchConfig.mockReset();
  });

  it("should throw when bench config is not configured", async () => {
    mockLoadBenchConfig.mockReturnValue(null);

    await expect(benchRunner.runBench()).rejects.toThrow(
      "Bench not configured. Set nimis.benchPath to a bench.json file"
    );
  });

  it("should throw when bench config is not configured (inline)", async () => {
    mockLoadBenchConfig.mockReturnValue(null);

    await expect(benchRunner.runBench({ testIds: ["two_sum"] })).rejects.toThrow(
      "Bench not configured"
    );
  });
});

describe("sortByDependencies", () => {
  it("should order tests so dependencies run first", () => {
    const tests: BenchTest[] = [
      { id: "c", promptPath: "c.md", outputPath: "c.py", dependencies: ["a", "b"] },
      { id: "a", promptPath: "a.md", outputPath: "a.py" },
      { id: "b", promptPath: "b.md", outputPath: "b.py", dependencies: ["a"] },
    ];
    const sorted = benchRunner.sortByDependencies(tests);
    const ids = sorted.map((t) => t.id);
    expect(ids.indexOf("a")).toBeLessThan(ids.indexOf("b"));
    expect(ids.indexOf("b")).toBeLessThan(ids.indexOf("c"));
    expect(ids).toHaveLength(3);
  });

  it("should handle tests with no dependencies", () => {
    const tests: BenchTest[] = [
      { id: "x", promptPath: "x.md", outputPath: "x.py" },
      { id: "y", promptPath: "y.md", outputPath: "y.py" },
    ];
    const sorted = benchRunner.sortByDependencies(tests);
    expect(sorted.map((t) => t.id)).toEqual(["x", "y"]);
  });
});

describe("applyUnifiedDiffPatch", () => {
  it("should apply a simple unified diff hunk", () => {
    const input = [
      "function add(a, b) {",
      "  return a + b;",
      "}",
      "",
    ].join("\n");

    const patch = [
      "@@ -2,1 +2,1 @@",
      "-  return a + b;",
      "+  return a - b;",
    ].join("\n");

    const out = benchRunner.applyUnifiedDiffPatch(input, patch);
    expect(out).toContain("return a - b;");
    expect(out).not.toContain("return a + b;");
  });

  it("should respect context lines", () => {
    const input = ["a", "b", "c", "d", ""].join("\n");
    const patch = [
      "@@ -2,2 +2,2 @@",
      " b",
      "-c",
      "+C",
    ].join("\n");

    const out = benchRunner.applyUnifiedDiffPatch(input, patch);
    expect(out).toBe(["a", "b", "C", "d", ""].join("\n"));
  });
});
