/**
 * Agent-facing tests for ax-content.
 *
 * ax-content gives the agent a named handle to target a region of the page.
 * The agent uses ax.get("scope-name") to find and interact with specific regions.
 * ax-content does not interrupt the template pipeline — it's purely a client-side filter.
 *
 * Scope registration:
 * - ax.get() auto-processes when scope is missing from the cache
 * - Nested elements do not overwrite parent scope registration
 * - ax-view also creates retrievable scopes
 * - Duplicate scopes at the same level error
 * - Duplicate scopes at different levels do not error
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

    ax.scan();
    const scope = ax.get("todo list");
    expect(scope).toBeDefined();

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

    expect(ax.get("dashboard")).toBeDefined();
    expect(tree.find((t) => t.name === "stats")).toBeDefined();
    expect(tree.find((t) => t.name === "settings")).toBeDefined();
    expect(tree.find((t) => t.name === "refresh")).toBeDefined();
  });

  describe("scope registration — robustness", () => {
    it("ax.get auto-processes when scope is missing from the cache", () => {
      document.body.innerHTML = `
        <div ax-content="auto" ax-view="auto scope">
          <p>Content</p>
        </div>
      `;

      const scope = ax.get("auto");

      expect(scope).toBeDefined();
      expect(scope.name).toBe("auto");
    });

    it("nested elements do not overwrite parent scope registration", () => {
      document.body.innerHTML = `
        <div ax-content="parent" ax-view="parent view">
          <div ax-content="child" ax-view="child view">
            <p>Inner</p>
          </div>
        </div>
      `;

      ax.scan();

      const parent = ax.get("parent");
      const child = ax.get("child");

      expect(parent).toBeDefined();
      expect(child).toBeDefined();

      expect(parent.name).toBe("parent");
      expect(parent.element.getAttribute("ax-content")).toBe("parent");

      expect(child.name).toBe("child");
      expect(child.element.getAttribute("ax-content")).toBe("child");

      expect(parent.element).not.toBe(child.element);
    });

    it("ax-view creates a scope retrievable with ax.get", () => {
      document.body.innerHTML = `
        <main ax-view="main section">
          <p>Hello</p>
        </main>
      `;

      ax.scan();
      const scope = ax.get("main section");

      expect(scope).toBeDefined();
      expect(scope.name).toBe("main section");
    });

    it("ax-view scope is not overwritten by nested elements", () => {
      document.body.innerHTML = `
        <div ax-view="outer">
          <p>Outer content</p>
          <div ax-view="inner">
            <p>Inner content</p>
          </div>
        </div>
      `;

      ax.scan();

      const outer = ax.get("outer");
      const inner = ax.get("inner");

      expect(outer).toBeDefined();
      expect(inner).toBeDefined();
      expect(outer.element).not.toBe(inner.element);
    });
  });

  describe("duplicate scopes", () => {
    it("duplicate ax-content scopes at the same level throw an error", () => {
      document.body.innerHTML = `
        <div>
          <div ax-content="tasks">Task A</div>
          <div ax-content="tasks">Task B</div>
        </div>
      `;

      expect(() => ax.scan()).toThrow();
    });

    it("duplicate ax-view names at the same level throw an error", () => {
      document.body.innerHTML = `
        <div>
          <div ax-view="metrics">Metric A</div>
          <div ax-view="metrics">Metric B</div>
        </div>
      `;

      expect(() => ax.scan()).toThrow();
    });

    it("duplicate scopes at different levels do NOT error", () => {
      document.body.innerHTML = `
        <div ax-content="tasks">
          <div ax-content="tasks">
            <p>Nested duplicate is allowed</p>
          </div>
        </div>
      `;

      expect(() => ax.scan()).not.toThrow();
    });

    it("duplicate ax-view names at different levels do NOT error", () => {
      document.body.innerHTML = `
        <div ax-view="section">
          <div ax-view="section">
            <p>Nested section</p>
          </div>
        </div>
      `;

      expect(() => ax.scan()).not.toThrow();
    });

    it("duplicate scope at same level — innermost ax.get resolves to closest defining ancestor", () => {
      document.body.innerHTML = `
        <div ax-content="outer" ax-view="outer view">
          <div ax-content="tasks">
            <p>Task content</p>
          </div>
          <div ax-content="tasks">
            <p>More tasks</p>
          </div>
        </div>
      `;

      // Duplicate scopes at same level should throw before we can test get()
      expect(() => ax.scan()).toThrow();
    });
  });
});
