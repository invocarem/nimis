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
    })),
  },
}));

jest.mock("../../src/utils/bench/benchLoader");

import { loadBenchConfig } from "../../src/utils/bench/benchLoader";
import { runBench } from "../../src/utils/bench/benchRunner";

const mockLoadBenchConfig = loadBenchConfig as jest.MockedFunction<typeof loadBenchConfig>;

describe("runBench", () => {
  beforeEach(() => {
    mockLoadBenchConfig.mockReset();
  });

  it("should throw when bench config is not configured", async () => {
    mockLoadBenchConfig.mockReturnValue(null);

    await expect(runBench()).rejects.toThrow(
      "Bench not configured. Set nimis.benchPath to a bench.json file"
    );
  });

  it("should throw when bench config is not configured (inline)", async () => {
    mockLoadBenchConfig.mockReturnValue(null);

    await expect(runBench({ testIds: ["two_sum"] })).rejects.toThrow(
      "Bench not configured"
    );
  });
});
