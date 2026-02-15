// Jest setup for client-side testing
// Mock DOM functions needed by markdownFormatter

global.document = {
  createElement: (tag) => {
    const element = {
      textContent: "",
      innerHTML: "",
      tagName: tag.toUpperCase(),
      set textContent(value) {
        this._textContent = value;
        // Simulate HTML escaping
        this.innerHTML = value
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");
      },
      get textContent() {
        return this._textContent;
      },
    };
    return element;
  },
};

global.window = {};

// Mock VS Code API
global.acquireVsCodeApi = () => ({
  postMessage: jest.fn(),
});

// Mock clipboard API
global.navigator = {
  clipboard: {
    writeText: jest.fn().mockResolvedValue(),
  },
};
