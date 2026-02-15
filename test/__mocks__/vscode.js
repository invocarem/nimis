// Minimal manual mock of the VS Code API used by tests
const workspaceFolders = [ { uri: { fsPath: "/home/chenchen/code/nimis" } } ];

module.exports = {
  workspace: {
    workspaceFolders,
    getConfiguration: (section) => ({ get: (key, defaultValue) => defaultValue }),
    onDidChangeConfiguration: (cb) => ({ dispose: () => {} }),
  },
  window: {
    activeTextEditor: null,
    registerWebviewViewProvider: jest.fn(),
    showInformationMessage: jest.fn(),
  },
  commands: {
    registerCommand: jest.fn().mockReturnValue({ dispose: () => {} }),
    executeCommand: jest.fn(),
  },
  Uri: {
    file: (s) => ({ fsPath: s }),
    joinPath: (...parts) => ({ fsPath: parts.join("/") }),
  },
  Disposable: {
    from: () => ({ dispose: () => {} }),
  },
};