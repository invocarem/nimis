import * as path from "path";
import { assertWithinWorkspace } from "../src/utils/workspacePath";

const isWindows = process.platform === "win32";

describe("assertWithinWorkspace", () => {
  const workspaceRoot = isWindows
    ? "C:\\code\\github\\nimis"
    : "/home/user/projects/nimis";

  describe("allows paths inside the workspace", () => {
    it("should allow a file directly inside workspace root", () => {
      const filePath = path.join(workspaceRoot, "file.txt");
      expect(() =>
        assertWithinWorkspace(filePath, workspaceRoot)
      ).not.toThrow();
    });

    it("should allow a file in a nested subdirectory", () => {
      const filePath = path.join(workspaceRoot, "src", "utils", "helper.ts");
      expect(() =>
        assertWithinWorkspace(filePath, workspaceRoot)
      ).not.toThrow();
    });

    it("should allow the workspace root itself", () => {
      expect(() =>
        assertWithinWorkspace(workspaceRoot, workspaceRoot)
      ).not.toThrow();
    });
  });

  describe("blocks paths outside the workspace", () => {
    it("should reject a path in a sibling directory", () => {
      const filePath = isWindows
        ? "C:\\code\\github\\other-project\\secret.txt"
        : "/home/user/projects/other-project/secret.txt";
      expect(() => assertWithinWorkspace(filePath, workspaceRoot)).toThrow(
        "Access denied"
      );
    });

    it("should reject a path in a parent directory", () => {
      const filePath = isWindows
        ? "C:\\code\\github\\secret.txt"
        : "/home/user/projects/secret.txt";
      expect(() => assertWithinWorkspace(filePath, workspaceRoot)).toThrow(
        "Access denied"
      );
    });

    it("should reject a completely unrelated path", () => {
      const filePath = isWindows
        ? "D:\\other\\place\\file.txt"
        : "/tmp/file.txt";
      expect(() => assertWithinWorkspace(filePath, workspaceRoot)).toThrow(
        "Access denied"
      );
    });

    it("should reject path traversal via ..", () => {
      const filePath = path.resolve(
        workspaceRoot,
        "..",
        "other-project",
        "file.txt"
      );
      expect(() => assertWithinWorkspace(filePath, workspaceRoot)).toThrow(
        "Access denied"
      );
    });
  });

  describe("blocks prefix attacks", () => {
    it("should reject a directory whose name starts with the workspace name", () => {
      const filePath = isWindows
        ? "C:\\code\\github\\nimis-evil\\steal.txt"
        : "/home/user/projects/nimis-evil/steal.txt";
      expect(() => assertWithinWorkspace(filePath, workspaceRoot)).toThrow(
        "Access denied"
      );
    });
  });

  if (isWindows) {
    describe("Windows-specific: case insensitivity", () => {
      it("should allow path with different casing", () => {
        const filePath = "C:\\CODE\\GITHUB\\NIMIS\\src\\index.ts";
        expect(() =>
          assertWithinWorkspace(filePath, workspaceRoot)
        ).not.toThrow();
      });

      it("should reject outside path regardless of casing", () => {
        const filePath = "C:\\CODE\\GITHUB\\OTHER\\file.txt";
        expect(() => assertWithinWorkspace(filePath, workspaceRoot)).toThrow(
          "Access denied"
        );
      });
    });
  }
});
