/**
 * Agent-facing tests for ax-click.
 *
 * When an agent wants to trigger an action on the page, it reads ax-click elements.
 * The output is a skill(name, ...) call — the agent's entry point for invoking actions.
 */

import { describe, it, expect, beforeEach } from "bun:test";

/** @type {typeof import("../../src/index.js").default} */
let ax;

beforeEach(async () => {
  const mod = await import("../../src/index.js");
  ax = mod.default;
  document.body.innerHTML = "";
});

describe("ax-click — agent triggerable actions", () => {
  it("scan returns available click actions as skill calls", () => {
    document.body.innerHTML = `
      <button ax-click="summarize">Summarize</button>
    `;

    const tree = ax.scan();

    expect(tree).toHaveLength(1);
    expect(tree[0].type).toBe("skill");
    expect(tree[0].name).toBe("summarize");
  });

  it("agent sees the button text as part of the skill call", () => {
    document.body.innerHTML = `
      <button ax-click="summarize">Summarize this article</button>
    `;

    const tree = ax.scan();

    expect(tree[0].text).toBe("Summarize this article");
  });

  it("agent discovers multiple click actions on a page", () => {
    document.body.innerHTML = `
      <button ax-click="summarize">Summarize</button>
      <button ax-click="translate">Translate</button>
      <button ax-click="export">Export as PDF</button>
    `;

    const tree = ax.scan();
    const names = tree.map((t) => t.name);

    expect(names).toContain("summarize");
    expect(names).toContain("translate");
    expect(names).toContain("export");
    expect(tree).toHaveLength(3);
  });

  it("agent sees content inside a click action's subtree", () => {
    document.body.innerHTML = `
      <div ax-click="process">
        <span data-point="1">Alpha</span>
        <span data-point="2">Beta</span>
      </div>
    `;

    const tree = ax.scan();

    expect(tree[0].children).toBeDefined();
    expect(tree[0].children.length).toBeGreaterThan(0);
  });

  it("agent can walk a click element directly for its composed output", () => {
    document.body.innerHTML = `
      <button ax-click="summarize">Click me</button>
    `;

    const btn = document.querySelector("[ax-click]");
    const result = ax.walk(btn);

    expect(result.type).toBe("skill");
    expect(result.name).toBe("summarize");
    expect(result.text).toBe("Click me");
  });
});
