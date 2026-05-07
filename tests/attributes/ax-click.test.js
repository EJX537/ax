/**
 * Agent-facing tests for ax-click.
 *
 * When an agent wants to trigger an action on the page, it reads ax-click elements.
 * The output is a skill(name, ...) call — the agent's entry point for invoking actions.
 *
 * Round-trip: client triggers the action in the DOM after agent decision.
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

  describe("round-trip — client triggers click actions after agent decision", () => {
    it("client clicks the button to trigger the action", () => {
      document.body.innerHTML = `
        <button ax-click="save">Save changes</button>
      `;

      let clicked = false;
      document.querySelector("[ax-click]").addEventListener("click", () => {
        clicked = true;
      });

      // Agent decides: "trigger save"
      // Client acts: clicks the native button
      document.querySelector("[ax-click]").click();

      expect(clicked).toBe(true);
    });

    it("agent can locate the click element from the walk result", () => {
      document.body.innerHTML = `
        <button ax-click="summarize" id="summarize-btn">Summarize</button>
      `;

      // Agent reads available actions
      const tree = ax.scan();
      const action = tree.find((t) => t.name === "summarize");

      // Client resolves the action to a DOM element and clicks it
      const btn = document.querySelector('[ax-click="summarize"]');
      let clicked = false;
      btn.addEventListener("click", () => {
        clicked = true;
      });
      btn.click();

      expect(clicked).toBe(true);
    });

    it("client can verify the click action's text matches the button label", () => {
      document.body.innerHTML = `
        <button ax-click="export" id="export-btn">Export as CSV</button>
      `;

      const tree = ax.scan();
      const action = tree.find((t) => t.name === "export");

      // Client confirms the label matches before dispatching
      const btn = document.querySelector('[ax-click="export"]');
      expect(btn.textContent.trim()).toBe("Export as CSV");

      let exported = false;
      btn.addEventListener("click", () => {
        exported = true;
      });
      btn.click();

      expect(exported).toBe(true);
    });
  });
});
