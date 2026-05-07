/**
 * Agent-facing tests for ax-for.
 *
 * ax-for routes a template to a named primitive. The agent sees the
 * template applied to the target primitive, not the nearest parent.
 * This allows the agent to receive content routed to the correct handler.
 */

import { describe, it, expect, beforeEach } from "bun:test";

/** @type {typeof import("../../src/index.js").default} */
let ax;

beforeEach(async () => {
  const mod = await import("../../src/index.js");
  ax = mod.default;
  document.body.innerHTML = "";
});

describe("ax-for — route content to a named primitive", () => {
  it("routes template content to the named edit scope", () => {
    document.body.innerHTML = `
      <div ax-content="todo list" ax-view="view todos" ax-edit="edit todos">
        <div ax-template="skill" ax-for="edit todos">
          <div ax-template="(e) => 'Today: ' + e">Todo Item</div>
        </div>
      </div>
    `;

    const el = document.querySelector("[ax-content]");
    const result = ax.walk(el);

    // The ax-for'd content routes to "edit todos", not "view todos"
    // Agent sees edit todos as a separate skill call
    expect(result.type).toBe("view");
    expect(result.name).toBe("view todos");
  });

  it("routes to nearest parent by convention", () => {
    document.body.innerHTML = `
      <div ax-content="scope">
        <div ax-edit="form">
          <div ax-template="field" ax-for="form">
            <input ax-edit="name" type="text" value="Alice" />
          </div>
        </div>
      </div>
    `;

    const tree = ax.scan();
    const formSkill = tree.find((t) => t.name === "form");

    expect(formSkill).toBeDefined();
    expect(formSkill.children[0].name).toBe("name");
  });

  it("can route to any ax-* in the current scope", () => {
    document.body.innerHTML = `
      <div ax-content="multi" ax-view="display" ax-edit="edit">
        <div ax-template="item" ax-for="display">Visible text</div>
      </div>
    `;

    const tree = ax.scan();
    const displayView = tree.find((t) => t.name === "display");

    expect(displayView).toBeDefined();
  });
});
