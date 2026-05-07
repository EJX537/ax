/**
 * Agent-facing tests for ax-swap.
 *
 * ax-swap tells the agent what kind of context change to expect when
 * following an ax-nav link. It's a hint — the agent uses it to decide
 * how to handle the navigation result.
 *
 * Suggested values: "page", "region", "modal"
 * Clients may define additional values.
 */

import { describe, it, expect, beforeEach } from "bun:test";

/** @type {typeof import("../../src/index.js").default} */
let ax;

beforeEach(async () => {
  const mod = await import("../../src/index.js");
  ax = mod.default;
  document.body.innerHTML = "";
});

describe("ax-swap — context change hints for agents", () => {
  it("agent sees 'page' swap hint for full page navigation", () => {
    document.body.innerHTML = `
      <a ax-nav="next page" ax-swap="page" href="/page/2">Next</a>
    `;

    const tree = ax.scan();
    expect(tree[0].swap).toBe("page");
  });

  it("agent sees 'region' swap hint for in-place updates", () => {
    document.body.innerHTML = `
      <a ax-nav="load more" ax-swap="region" href="/items?page=2">Load more</a>
    `;

    const tree = ax.scan();
    expect(tree[0].swap).toBe("region");
  });

  it("agent sees 'modal' swap hint for overlay content", () => {
    document.body.innerHTML = `
      <a ax-nav="preview" ax-swap="modal" href="/preview">Preview</a>
    `;

    const tree = ax.scan();
    expect(tree[0].swap).toBe("modal");
  });

  it("agent sees custom swap values beyond the suggested set", () => {
    document.body.innerHTML = `
      <a ax-nav="stream" ax-swap="websocket" href="/stream">Live</a>
    `;

    const tree = ax.scan();
    expect(tree[0].swap).toBe("websocket");
  });

  it("ax-nav without ax-swap omits the swap field in output", () => {
    document.body.innerHTML = `
      <a ax-nav="next page" href="/page/2">Next</a>
    `;

    const tree = ax.scan();
    expect(tree[0].swap).toBeUndefined();
  });

  it("agent sees swap values across multiple nav actions", () => {
    document.body.innerHTML = `
      <div>
        <a ax-nav="home" ax-swap="page" href="/">Home</a>
        <a ax-nav="preview" ax-swap="modal" href="/preview">Preview</a>
      </div>
    `;

    const tree = ax.scan();
    const swaps = tree.map((t) => ({ name: t.name, swap: t.swap }));

    expect(swaps).toContainEqual({ name: "home", swap: "page" });
    expect(swaps).toContainEqual({ name: "preview", swap: "modal" });
  });

  it("swap hint is available via ax.walk() on the element", () => {
    document.body.innerHTML = `
      <a ax-nav="next" ax-swap="page" href="/page/2">Next</a>
    `;

    const el = document.querySelector("[ax-nav]");
    const result = ax.walk(el);

    expect(result.swap).toBe("page");
    expect(result.href).toBe("/page/2");
  });
});
