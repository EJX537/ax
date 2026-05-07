/**
 * Agent-facing tests for ax-content.
 *
 * ax-content gives the agent a named handle to target a region of the page.
 * The agent uses ax.get("scope-name") to find and interact with specific regions.
 * ax-content does not interrupt the template pipeline — it's purely a client-side filter.
 */

import { describe, it, expect, beforeEach } from "bun:test";

/** @type {typeof import("../../src/index.js").default} */
let ax;

beforeEach(async () => {
  const mod = await import("../../src/index.js");
  ax = mod.default;
  document.body.innerHTML = "";
});

describe("ax-content — agent scope targeting", () => {
  it("agent can target a named scope via ax.get()", () => {
    document.body.innerHTML = `
      <div ax-content="todo list" ax-view="view todos">
        <ul>
          <li>Task 1</li>
          <li>Task 2</li>
        </ul>
      </div>
    `;

    // Process the DOM first so scopes are registered
    ax.process(document.body);
    const scope = ax.get("todo list");

    expect(scope).toBeDefined();
    expect(scope.name).toBe("todo list");
    expect(scope.element).toBeInstanceOf(Element);
  });

  it("ax-content coexists with multiple primitives on the same element", () => {
    document.body.innerHTML = `
      <div ax-content="todo list" ax-view="view todos" ax-edit="edit todos">
        <ul>
          <li>Task 1</li>
        </ul>
        <input ax-edit="new task" type="text" />
      </div>
    `;

    // Agent scans first to process the body, then accesses scopes
    ax.scan();
    const scope = ax.get("todo list");
    expect(scope).toBeDefined();

    // The scope element has both view and edit primitives
    const primitives = scope.primitives;
    expect(primitives.view.name).toBe("view todos");
    expect(primitives.edit.name).toBe("edit todos");
  });

  it("scopes nest — agent sees different scopes in different regions", () => {
    document.body.innerHTML = `
      <div ax-content="sidebar" ax-view="sidebar">
        <p>Sidebar content</p>
      </div>
      <div ax-content="main" ax-view="main article">
        <article>Article content</article>
      </div>
    `;

    // Agent scans first to process the body
    ax.scan();
    const sidebar = ax.get("sidebar");
    const main = ax.get("main");

    expect(sidebar).toBeDefined();
    expect(main).toBeDefined();
    expect(sidebar.element).not.toBe(main.element);
  });

  it("can scope multiple primitives under one content label", () => {
    document.body.innerHTML = `
      <div ax-content="dashboard">
        <section ax-view="stats">
          <p>5 active users</p>
        </section>
        <form ax-edit="settings">
          <input ax-edit="theme" type="text" value="dark" />
        </form>
        <button ax-click="refresh">Refresh</button>
      </div>
    `;

    const tree = ax.scan();

    // The dashboard scope is set, and agent sees all primitives within
    expect(ax.get("dashboard")).toBeDefined();
    expect(tree.find((t) => t.name === "stats")).toBeDefined();
    expect(tree.find((t) => t.name === "settings")).toBeDefined();
    expect(tree.find((t) => t.name === "refresh")).toBeDefined();
  });
});
