/**
 * Agent-facing tests for ax-ignore.
 *
 * ax-ignore tells the agent to skip an element and all its descendants.
 * The agent will not see, read, or interact with ignored regions.
 * It is the only ax-* attribute that does not require a value.
 */

import { describe, it, expect, beforeEach } from "bun:test";

/** @type {typeof import("../../src/index.js").default} */
let ax;

beforeEach(async () => {
  const mod = await import("../../src/index.js");
  ax = mod.default;
  document.body.innerHTML = "";
});

describe("ax-ignore — agent content exclusion", () => {
  it("agent does not see ignored elements in scan output", () => {
    document.body.innerHTML = `
      <ul ax-view="todo list">
        <li>Visible item</li>
        <li ax-ignore>Draft — not ready</li>
      </ul>
    `;

    const tree = ax.scan();
    const children = tree[0].children.map((c) => c.text);

    expect(children).toHaveLength(1);
    expect(children).toContain("Visible item");
    expect(children).not.toContain("Draft — not ready");
  });

  it("agent does not see descendants of ignored elements", () => {
    document.body.innerHTML = `
      <section ax-view="page">
        <div ax-ignore>
          <div>
            <p>Deeply hidden content</p>
            <p>Also hidden</p>
          </div>
        </div>
        <p>Visible content</p>
      </section>
    `;

    const tree = ax.scan();
    const texts = tree[0].children.map((c) => c.text);

    expect(texts).not.toContain("Deeply hidden content");
    expect(texts).not.toContain("Also hidden");
    expect(texts).toContain("Visible content");
  });

  it("ignored elements with ax-* attributes are not processed", () => {
    document.body.innerHTML = `
      <div ax-view="page">
        <div ax-ignore>
          <button ax-click="hidden-action">Hidden</button>
        </div>
      </div>
    `;

    const tree = ax.scan();

    // The hidden action should not appear in scan
    const hiddenAction = tree.find((t) => t.name === "hidden-action");
    expect(hiddenAction).toBeUndefined();
  });

  it("agent sees unaffected siblings correctly", () => {
    document.body.innerHTML = `
      <ul ax-view="list">
        <li>First</li>
        <li ax-ignore>Second — ignore</li>
        <li>Third</li>
        <li>Fourth</li>
        <li ax-ignore>Fifth — ignore</li>
      </ul>
    `;

    const tree = ax.scan();
    const texts = tree[0].children.map((c) => c.text);

    expect(texts).toEqual(["First", "Third", "Fourth"]);
  });

  it("ax-ignore does not require a value (presence-only)", () => {
    // ax-ignore with no value should not throw — it's presence-only
    document.body.innerHTML = `
      <div ax-view="page">
        <span ax-ignore>Hidden</span>
      </div>
    `;

    expect(() => ax.scan()).not.toThrow();
  });

  it("ignored elements do not expose hooks or status", () => {
    document.body.innerHTML = `
      <div ax-view="page">
        <button ax-click="hidden"
                ax-ignore
                ax-beforeClick="shouldNotAppear()"
                disabled>Hidden</button>
      </div>
    `;

    const tree = ax.scan();
    const hiddenAction = tree.find((t) => t.name === "hidden");

    // The ignored element should not appear at all
    expect(hiddenAction).toBeUndefined();
  });

  it("ignored container with nested hooks/status is fully excluded", () => {
    document.body.innerHTML = `
      <div ax-view="page">
        <div ax-ignore>
          <button ax-click="deep"
                  ax-beforeClick="nope()"
                  aria-busy="true">Deep</button>
          <input ax-edit="field" type="text" disabled />
        </div>
      </div>
    `;

    const tree = ax.scan();
    const names = tree.map((t) => t.name);

    // Nothing from inside ax-ignore should appear
    expect(names).not.toContain("deep");
    expect(names).not.toContain("field");
  });
});
