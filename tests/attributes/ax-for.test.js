/**
 * Agent-facing tests for ax-for.
 *
 * ax-for routes a template to a named primitive. The agent sees the
 * template applied to the target primitive, not the nearest parent.
 * This allows the agent to receive content routed to the correct handler.
 *
 * Invalid ax-for targets are silently ignored (the template group
 * is not included in any output).
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

  it("invalid ax-for target name is silently ignored", () => {
    document.body.innerHTML = `
      <div ax-content="scope" ax-view="main">
        <div ax-template="item" ax-for="nonexistent">
          Orphaned content
        </div>
        <p>Visible item</p>
      </div>
    `;

    const el = document.querySelector("[ax-content]");
    const result = ax.walk(el);

    // The orphaned group should not appear — only "Visible item" is a child
    expect(result.children).toHaveLength(1);
    expect(result.children[0].text).toBe("Visible item");
  });

  it("invalid ax-for on a skill element does not throw", () => {
    document.body.innerHTML = `
      <div ax-content="scope" ax-view="main">
        <button ax-click="save" ax-for="nowhere">Save</button>
      </div>
    `;

    // Should not throw — invalid ax-for is ignored
    expect(() => ax.scan()).not.toThrow();
  });
});
