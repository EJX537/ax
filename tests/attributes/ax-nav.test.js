/**
 * Agent-facing tests for ax-nav.
 *
 * ax-nav tells an agent about navigation targets.
 * - Distinguished from ax-click — signals that following this changes the agent's context
 * - Carries href and optional ax-swap hint so the agent knows what kind of context change to expect
 *
 * Round-trip: client navigates after agent decision.
 */

import { describe, it, expect, beforeEach } from "bun:test";

/** @type {typeof import("../../src/index.js").default} */
let ax;

beforeEach(async () => {
  const mod = await import("../../src/index.js");
  ax = mod.default;
  document.body.innerHTML = "";
});

describe("ax-nav — agent navigation targets", () => {
  it("scan returns nav elements as skill calls with href", () => {
    document.body.innerHTML = `
      <a ax-nav="next page" href="/page/2">Next</a>
    `;

    const tree = ax.scan();

    expect(tree).toHaveLength(1);
    expect(tree[0].type).toBe("skill");
    expect(tree[0].name).toBe("next page");
    expect(tree[0].href).toBe("/page/2");
  });

  it("agent sees nav link text", () => {
    document.body.innerHTML = `
      <a ax-nav="next page" href="/page/2">Next &rarr;</a>
    `;

    const tree = ax.scan();
    expect(tree[0].text).toMatch(/Next/);
  });

  it("agent can distinguish ax-nav from ax-click by name/context", () => {
    document.body.innerHTML = `
      <a ax-nav="next page" href="/page/2">Next</a>
      <button ax-click="save">Save</button>
    `;

    const tree = ax.scan();

    const navAction = tree.find((t) => t.href);
    const clickAction = tree.find((t) => !t.href);

    // Both are type "skill" but nav has href, click doesn't
    expect(navAction.href).toBe("/page/2");
    expect(clickAction.href).toBeUndefined();
  });

  it("agent sees ax-swap hint as context change type", () => {
    document.body.innerHTML = `
      <a ax-nav="next page" ax-swap="page" href="/page/2">Next</a>
      <a ax-nav="load more" ax-swap="region" href="/items?page=2">More</a>
      <a ax-nav="preview" ax-swap="modal" href="/preview">Preview</a>
    `;

    const tree = ax.scan();

    expect(tree.find((t) => t.name === "next page").swap).toBe("page");
    expect(tree.find((t) => t.name === "load more").swap).toBe("region");
    expect(tree.find((t) => t.name === "preview").swap).toBe("modal");
  });

  it("agent sees nav actions even on non-anchor elements", () => {
    document.body.innerHTML = `
      <div ax-nav="load more" data-url="/items?page=2">Load more</div>
    `;

    const tree = ax.scan();

    expect(tree).toHaveLength(1);
    expect(tree[0].type).toBe("skill");
    expect(tree[0].name).toBe("load more");
  });

  it("agent sees all nav actions on a page for navigation planning", () => {
    document.body.innerHTML = `
      <nav>
        <a ax-nav="home" href="/">Home</a>
        <a ax-nav="about" href="/about">About</a>
        <a ax-nav="contact" href="/contact">Contact</a>
      </nav>
    `;

    const tree = ax.scan();
    const names = tree.map((t) => t.name);

    expect(names).toEqual(["home", "about", "contact"]);
  });

  describe("round-trip — client navigates after agent decision", () => {
    it("client reads href from ax-nav to know where to navigate", () => {
      document.body.innerHTML = `
        <a ax-nav="next page" href="/page/2">Next</a>
      `;

      const tree = ax.scan();
      const nav = tree.find((t) => t.name === "next page");

      // Agent sees the href and decides to follow it
      expect(nav.href).toBe("/page/2");
    });

    it("client uses ax-swap to decide HOW to handle the navigation result", () => {
      document.body.innerHTML = `
        <a ax-nav="load more" ax-swap="region" href="/items?page=2">More</a>
      `;

      const tree = ax.scan();
      const nav = tree.find((t) => t.name === "load more");

      // swap="region" tells the client to replace a region, not the full page
      expect(nav.swap).toBe("region");
      expect(nav.href).toBe("/items?page=2");
    });

    it("client navigates by following the anchor's native behavior", () => {
      document.body.innerHTML = `
        <a ax-nav="home" ax-swap="page" href="/" id="home-link">Home</a>
      `;

      // Client can read the href to navigate programmatically
      const href = document.querySelector("#home-link").getAttribute("href");
      expect(href).toBe("/");
    });
  });
});
