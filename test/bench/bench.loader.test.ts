import * as path from "path";

const mockGet = jest.fn();
jest.mock("vscode", () => ({
  workspace: {
    getConfiguration: jest.fn(() => ({
      get: mockGet,
    })),
  },
}));

import { loadBenchConfig } from "../../src/utils/bench/benchLoader";

const BENCH_DIR = path.resolve(__dirname);
const BENCH_JSON = path.join(BENCH_DIR, "bench.json");

describe("loadBenchConfig", () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  describe("from benchPath (file)", () => {
    it("should load config from bench.json when benchPath is set", () => {
      mockGet.mockImplementation((key: string, defaultValue: unknown) => {
        if (key === "benchPath") return BENCH_JSON;
        if (key === "bench") return null;
        return defaultValue;
      });

      const result = loadBenchConfig();
      expect(result).not.toBeNull();
      expect(result!.benchDir).toBe(BENCH_DIR);
      expect(result!.config.tests).toHaveLength(3);
      expect(result!.config.tests[0]).toMatchObject({
        id: "two_sum",
        promptPath: path.resolve(BENCH_DIR, "two_sum/two_sum.md"),
        outputPath: path.resolve(BENCH_DIR, "outputs/two_sum/solution.py"),
        timeout: 60000,
      });
      expect(result!.config.tests[1]).toMatchObject({
        id: "two_sum_test",
        promptPath: path.resolve(BENCH_DIR, "two_sum/test.md"),
        outputPath: path.resolve(BENCH_DIR, "outputs/two_sum/test/test_two_sum.py"),
        testCommand: "python -m pytest outputs/two_sum/test/test_two_sum.py",
        dependencies: ["two_sum"],
      });
      expect(result!.config.tests[2]).toMatchObject({
        id: "same_tree",
        promptPath: path.resolve(BENCH_DIR, "same_tree/same_tree.md"),
        outputPath: path.resolve(BENCH_DIR, "outputs/same_tree/solution.py"),
        expectedPath: path.resolve(BENCH_DIR, "expected/same_tree/solution.py"),
      });
      expect(result!.config.tests[2].timeout).toBe(120000);
    });

    it("should return null when benchPath file does not exist", () => {
      mockGet.mockImplementation((key: string, defaultValue: unknown) => {
        if (key === "benchPath") return "/nonexistent/bench.json";
        if (key === "bench") return null;
        return defaultValue;
      });

      const result = loadBenchConfig();
      expect(result).toBeNull();
    });

    it("should return null when benchPath is empty string", () => {
      mockGet.mockImplementation((key: string, defaultValue: unknown) => {
        if (key === "benchPath") return "";
        if (key === "bench") return null;
        return defaultValue;
      });

      const result = loadBenchConfig();
      expect(result).toBeNull();
    });

    it("should return null when bench.json has invalid structure (no tests array)", () => {
      const invalidPath = path.join(BENCH_DIR, "invalid.json");
      mockGet.mockImplementation((key: string, defaultValue: unknown) => {
        if (key === "benchPath") return invalidPath;
        if (key === "bench") return null;
        return defaultValue;
      });

      const result = loadBenchConfig();
      expect(result).toBeNull();
    });
  });

  describe("from bench (inline)", () => {
    it("should load config from inline bench when benchPath is empty", () => {
      const baseDir = process.cwd();
      mockGet.mockImplementation((key: string, defaultValue: unknown) => {
        if (key === "benchPath") return "";
        if (key === "bench")
          return {
            tests: [
              {
                id: "inline_test",
                promptPath: "prompts/inline.md",
                outputPath: "outputs/inline.py",
              },
            ],
          };
        return defaultValue;
      });

      const result = loadBenchConfig();
      expect(result).not.toBeNull();
      expect(result!.benchDir).toBe(baseDir);
      expect(result!.config.tests).toHaveLength(1);
      expect(result!.config.tests[0]).toMatchObject({
        id: "inline_test",
        promptPath: path.resolve(baseDir, "prompts/inline.md"),
        outputPath: path.resolve(baseDir, "outputs/inline.py"),
      });
    });

    it("should apply defaults.timeout to tests without timeout", () => {
      mockGet.mockImplementation((key: string, defaultValue: unknown) => {
        if (key === "benchPath") return "";
        if (key === "bench")
          return {
            tests: [{ id: "t1", promptPath: "p.md", outputPath: "o.py" }],
            defaults: { timeout: 90000 },
          };
        return defaultValue;
      });

      const result = loadBenchConfig();
      expect(result!.config.tests[0].timeout).toBe(90000);
    });
  });

  describe("dependencies and testCommand", () => {
    it("should load dependencies and testCommand from benchPath file", () => {
      mockGet.mockImplementation((key: string, defaultValue: unknown) => {
        if (key === "benchPath") return BENCH_JSON;
        if (key === "bench") return null;
        return defaultValue;
      });

      const result = loadBenchConfig();
      expect(result).not.toBeNull();
      const twoSumTest = result!.config.tests.find((t) => t.id === "two_sum_test");
      expect(twoSumTest).toBeDefined();
      expect(twoSumTest!.dependencies).toEqual(["two_sum"]);
      expect(twoSumTest!.testCommand).toBe(
        "python -m pytest outputs/two_sum/test/test_two_sum.py"
      );
    });

    it("should load dependencies and testCommand from inline config", () => {
      mockGet.mockImplementation((key: string, defaultValue: unknown) => {
        if (key === "benchPath") return "";
        if (key === "bench")
          return {
            tests: [
              {
                id: "dep_test",
                promptPath: "p.md",
                outputPath: "o.py",
                dependencies: ["other_task"],
                testCommand: "pytest o.py",
              },
            ],
          };
        return defaultValue;
      });

      const result = loadBenchConfig();
      expect(result!.config.tests[0]).toMatchObject({
        id: "dep_test",
        dependencies: ["other_task"],
        testCommand: "pytest o.py",
      });
    });
  });

  describe("path resolution", () => {
    it("should resolve relative paths against bench dir", () => {
      mockGet.mockImplementation((key: string, defaultValue: unknown) => {
        if (key === "benchPath") return BENCH_JSON;
        if (key === "bench") return null;
        return defaultValue;
      });

      const result = loadBenchConfig();
      const twoSum = result!.config.tests[0];
      expect(path.isAbsolute(twoSum.promptPath)).toBe(true);
      expect(twoSum.promptPath).toContain("two_sum");
      expect(twoSum.outputPath).toContain("outputs");
    });
  });

  describe("priority", () => {
    it("should prefer benchPath over inline when both are set", () => {
      mockGet.mockImplementation((key: string, defaultValue: unknown) => {
        if (key === "benchPath") return BENCH_JSON;
        if (key === "bench")
          return {
            tests: [{ id: "inline_only", promptPath: "x.md", outputPath: "y.py" }],
          };
        return defaultValue;
      });

      const result = loadBenchConfig();
      expect(result!.config.tests.map((t) => t.id)).toContain("two_sum");
      expect(result!.config.tests.map((t) => t.id)).not.toContain("inline_only");
    });
  });
});
