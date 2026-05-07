/**
 * Agent-facing tests for ax-view.
 *
 * An agent reads page structure via ax.scan() and ax.walk().
 * ax-view describes what an agent can read — the output is a view(name, children) tree.
 */

import { describe, it, expect, beforeEach } from "bun:test";

/** @type {typeof import("../../src/index.js").default} */
let ax;

beforeEach(async () => {
  const mod = await import("../../src/index.js");
  ax = mod.default;
  document.body.innerHTML = "";
});

describe("ax-view — agent readable content", () => {
  it("scan returns a view tree with name and children", () => {
    document.body.innerHTML = `
      <ul ax-view="todo list">
        <li>Buy milk</li>
        <li>Write code</li>
      </ul>
    `;

    const tree = ax.scan();

    expect(tree).toHaveLength(1);
    expect(tree[0].type).toBe("view");
    expect(tree[0].name).toBe("todo list");
    expect(tree[0].children).toHaveLength(2);
    expect(tree[0].children[0].text).toBe("Buy milk");
    expect(tree[0].children[1].text).toBe("Write code");
  });

  it("agent sees child elements as 'item' type", () => {
    document.body.innerHTML = `
      <ul ax-view="todo list">
        <li>Buy milk</li>
        <li>Write code</li>
      </ul>
    `;

    const tree = ax.scan();
    const children = tree[0].children;

    expect(children[0].type).toBe("item");
    expect(children[1].type).toBe("item");
  });

  it("nested ax-view produces independent scopes for the agent", () => {
    document.body.innerHTML = `
      <div ax-view="page">
        <article ax-view="article">
          <p>Content inside article</p>
        </article>
      </div>
    `;

    const tree = ax.scan();

    // Agent sees two roots: "page" view and "article" view
    const pageView = tree.find((v) => v.name === "page");
    const articleView = tree.find((v) => v.name === "article");

    expect(pageView).toBeDefined();
    expect(articleView).toBeDefined();
    expect(articleView.children).toHaveLength(1);
    expect(articleView.children[0].text).toBe("Content inside article");
  });

  it("agent reads a view with no children as empty children array", () => {
    document.body.innerHTML = `
      <div ax-view="empty section"></div>
    `;

    const tree = ax.scan();

    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(0);
  });

  it("agent can get a named view scope directly via ax.get()", () => {
    document.body.innerHTML = `
      <main ax-view="article">
        <h1>Title</h1>
        <p>Body content</p>
      </main>
    `;

    const scope = ax.get("article");

    expect(scope).toBeDefined();
    expect(scope.name).toBe("article");
    expect(scope.element).toBeInstanceOf(Element);
  });

  it("agent does not see elements inside ax-ignore within a view", () => {
    document.body.innerHTML = `
      <ul ax-view="todo list">
        <li>Visible item</li>
        <li ax-ignore>Draft — not ready</li>
        <li>Another item</li>
      </ul>
    `;

    const tree = ax.scan();
    const children = tree[0].children;

    expect(children).toHaveLength(2);
    expect(children[0].text).toBe("Visible item");
    expect(children[1].text).toBe("Another item");
  });

  it("agent sees view-scoped elements even when nested in other elements", () => {
    document.body.innerHTML = `
      <div ax-view="page">
        <header>
          <h1>Site Title</h1>
          <nav><a href="/">Home</a></nav>
        </header>
        <main>
          <p>Body content</p>
        </main>
      </div>
    `;

    const tree = ax.scan();

    expect(tree[0].type).toBe("view");
    expect(tree[0].name).toBe("page");
    // All text nodes inside the view should be discovered
    expect(tree[0].children.length).toBeGreaterThan(0);
  });
});
