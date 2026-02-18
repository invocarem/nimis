import * as path from "path";
import { NimisStateTracker } from "../src/utils/nimisStateTracker";

describe("NimisStateTracker — currentFile", () => {
  it("setCurrentFile and formatForPrompt includes current file path", () => {
    const s = new NimisStateTracker();
    s.setCurrentFile("src/index.ts", "export const x = 1;");
    const prompt = s.formatForPrompt();
    expect(prompt).toContain("Current session state");
    expect(prompt).toContain(path.normalize("src/index.ts"));
    expect(prompt).toContain("(current)");
    expect(prompt).not.toContain("export const x = 1;");
  });

  it("clearCurrentFile and reset remove current file", () => {
    const s = new NimisStateTracker();
    s.setCurrentFile("a.ts", "console.log('a');");
    expect(s.getCurrentFilePath()).toBe("a.ts");
    s.clearCurrentFile();
    expect(s.getCurrentFilePath()).toBeUndefined();
    s.setCurrentFile("b.ts", "b");
    s.reset();
    expect(s.getCurrentFilePath()).toBeUndefined();
    expect(s.formatForPrompt()).toBe("");
  });

  it("ignores .nimis/state.json when setting current file", () => {
    const s = new NimisStateTracker();
    s.setCurrentFile(".nimis/state.json");
    expect(s.getCurrentFilePath()).toBeUndefined();

    s.setCurrentFile(path.join("some", "dir", ".nimis", "state.json"));
    expect(s.getCurrentFilePath()).toBeUndefined();

    s.setCurrentFile("src/foo.ts");
    expect(s.getCurrentFilePath()).toBe(path.normalize("src/foo.ts"));
  });
});
