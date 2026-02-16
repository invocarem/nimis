/**
 * @jest-environment jsdom
 */
const {
  formatMarkdown,
  setupThinkingBlockHandlers,
} = require("../src/webview/assets/markdownFormatter.js");

describe("Thinking block expand/collapse", () => {
  it("should toggle expanded class when header is clicked", () => {
    const input = "Text<thinking>Reasoning content</thinking>Answer";
    const html = formatMarkdown(input);
    const container = document.createElement("div");
    container.innerHTML = html;

    const block = container.querySelector(".thinking-block-container");
    const header = container.querySelector(".thinking-header");

    expect(block.classList.contains("expanded")).toBe(false);

    setupThinkingBlockHandlers(container);
    header.click();
    expect(block.classList.contains("expanded")).toBe(true);

    header.click();
    expect(block.classList.contains("expanded")).toBe(false);
  });

  it("should update aria-expanded attribute on toggle", () => {
    const input = "<thinking>Some reasoning</thinking>";
    const html = formatMarkdown(input);
    const container = document.createElement("div");
    container.innerHTML = html;

    const header = container.querySelector(".thinking-header");
    expect(header.getAttribute("aria-expanded")).toBe("false");

    setupThinkingBlockHandlers(container);
    header.click();
    expect(header.getAttribute("aria-expanded")).toBe("true");

    header.click();
    expect(header.getAttribute("aria-expanded")).toBe("false");
  });

  it("should handle multiple thinking blocks independently", () => {
    const input =
      "<thinking>First block</thinking>Middle<thinking>Second block</thinking>";
    const html = formatMarkdown(input);
    const container = document.createElement("div");
    container.innerHTML = html;

    const blocks = container.querySelectorAll(".thinking-block-container");
    const headers = container.querySelectorAll(".thinking-header");

    expect(blocks.length).toBe(2);

    setupThinkingBlockHandlers(container);

    headers[0].click();
    expect(blocks[0].classList.contains("expanded")).toBe(true);
    expect(blocks[1].classList.contains("expanded")).toBe(false);

    headers[1].click();
    expect(blocks[0].classList.contains("expanded")).toBe(true);
    expect(blocks[1].classList.contains("expanded")).toBe(true);
  });

  it("should no-op when container is null or has no querySelectorAll", () => {
    expect(() => setupThinkingBlockHandlers(null)).not.toThrow();
    expect(() => setupThinkingBlockHandlers(undefined)).not.toThrow();
  });
});
