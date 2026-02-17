import { NimisManager } from "../src/utils/nimisManager";
import { NativeToolsManager } from "../src/utils/nativeToolManager";

describe("NimisManager.buildToolDocs", () => {
  it("includes required parameters and descriptions for native tools", () => {
    const doc = (NimisManager as any).buildToolDocs(new NativeToolsManager());
    // Check for edit_file tool and its required params
    expect(doc).toMatch(
      /- edit_file: [\s\S]*required: file_path, old_text, new_text/
    );
    expect(doc).toMatch(/- file_path: Path to the file to edit/);
    expect(doc).toMatch(/- old_text: Exact text snippet to be replaced/);
    expect(doc).toMatch(
      /- new_text: The replacement text that will substitute/
    );
  });
});
