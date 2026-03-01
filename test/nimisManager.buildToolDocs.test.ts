import { NimisManager } from "../src/utils/nimisManager";
import { NativeToolsManager } from "../src/utils/nativeToolManager";

describe("NimisManager.buildToolDocs", () => {
  it("includes native tools section (only exec_terminal is exposed; it is omitted from docs by design)", () => {
    const doc = (NimisManager as any).buildToolDocs(new NativeToolsManager());
    expect(doc).toContain("**Available native tools:**");
  });
});
