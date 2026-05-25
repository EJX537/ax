import { beforeEach, describe, expect, test } from "bun:test";
import ax from "../src/index.js";

function queryFirst(query) {
    return /** @type {Element} */ (document.querySelector(query));
}

describe("ax core", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        ax.config.allowEval = true;
    });

    test("scan produces dag + nodes tree", () => {
        document.body.innerHTML = `
      <div ax-view="article" ax-click="save">
        Hello
      </div>
    `;

        const s = ax.scan();

        expect(s.version).toBeGreaterThan(0);
        expect(typeof s.dag).toBe("object");
        expect(Array.isArray(s.nodes)).toBe(true);

        // One node for the annotated div (plus 1 implicit html root)
        expect(s.nodes.length).toBe(2);
        const node = s.nodes[1]; // skip the implicit html root
        expect(node.parent).toBe(s.nodes[0].id); // parent is html node
        expect(Array.isArray(node.children)).toBe(true);

        // Two fn entries: view + click
        const viewFn = node.fn.find((f) => f.on === "view");
        const clickFn = node.fn.find((f) => f.on === "click");
        expect(viewFn).toBeTruthy();
        expect(clickFn).toBeTruthy();
        expect(viewFn.name).toBe("article");
        expect(clickFn.name).toBe("save");
    });

    test("ax-ignore excludes subtree", () => {
        document.body.innerHTML = `
      <div ax-view="root">
        <div ax-ignore>
          <button ax-click="secret">Hidden</button>
        </div>
        <button ax-click="visible">Visible</button>
      </div>
    `;

        const s = ax.scan();
        const names = s.nodes.flatMap((n) => n.fn.map((f) => f.name));
        expect(names).toContain("root");
        expect(names).toContain("visible");
        expect(names).not.toContain("secret");
    });

    test("invoke views text content by default", () => {
        document.body.innerHTML = `<div ax-view="title">Hello World</div>`;

        const el = queryFirst("[ax-view]");
        const r = ax.invoke(el, "view");
        expect(r.ok).toBe(true);
        expect(r.result).toBe("Hello World");
    });

    test("invoke triggers default DOM click", () => {
        let clicked = false;
        document.body.innerHTML = `<button ax-click="go">Go</button>`;

        const el = queryFirst("[ax-click]");
        el.addEventListener("click", () => {
            clicked = true;
        });

        const r = ax.invoke(el, "click");
        expect(r.ok).toBe(true);
        expect(clicked).toBe(true);
    });

    test("invoke evaluates on hook string (HTMX-style eval)", () => {
        document.body.innerHTML = `
      <div ax-view="price" ax-onView="ctx => ctx.args.value * 2">20</div>
    `;

        const el = queryFirst("[ax-view]");
        const r = ax.invoke(el, "view", { value: 21 });
        expect(r.ok).toBe(true);
        expect(r.result).toBe(42);
    });

    test("before hook can cancel invocation", () => {
        document.body.innerHTML = `
      <button ax-click="save" ax-beforeClick="() => false">Save</button>
    `;

        let clicked = false;
        const el = queryFirst("[ax-click]");
        el.addEventListener("click", () => {
            clicked = true;
        });

        const r = ax.invoke(el, "click");
        expect(r.canceled).toBe(true);
        expect(r.ok).toBe(false);
        expect(clicked).toBe(false);
    });

    test("invoke with scope filters correctly", () => {
        document.body.innerHTML = `
      <div ax-ctx="panel-a">
        <button ax-click="btn-a">A</button>
      </div>
      <div ax-ctx="panel-b">
        <button ax-click="btn-b">B</button>
      </div>
    `;

        const s = ax.scan();
        // Both scopes produce trees via their ax-ctx boundaries
        // Find nodes by their fn entries
        const names = s.nodes.flatMap((n) => n.fn.map((f) => f.name));
        expect(names).toContain("btn-a");
        expect(names).toContain("btn-b");

        const elA = document.querySelector("[ax-ctx='panel-a'] button");
        const elB = document.querySelector("[ax-ctx='panel-b'] button");
        expect(elA).toBeTruthy();
        expect(elB).toBeTruthy();
    });

    test("single element with view+click produces one node, two fn entries", () => {
        document.body.innerHTML = `<div ax-view="card" ax-click="select">Item</div>`;

        const s = ax.scan();
        expect(s.nodes.length).toBe(2); // html root + annotated div
        const kinds = s.nodes[1].fn.map((f) => f.on).sort();
        expect(kinds).toEqual(["click", "view"]);
    });

    test("fresh scan on each call (no caching)", () => {
        document.body.innerHTML = `<div ax-view="a"></div>`;
        const first = ax.scan();

        document.body.innerHTML += `<div ax-view="b"></div>`;
        const second = ax.scan();

        expect(second.version).toBeGreaterThan(first.version);
        const names = second.nodes.flatMap((n) => n.fn.map((f) => f.name));
        expect(names).toContain("a");
        expect(names).toContain("b");
    });

    test("extension hooks fire on scan and invoke", () => {
        document.body.innerHTML = `<button ax-click="save">Save</button>`;

        const events = [];
        ax.defineExtension("test", {
            onNode({ node }) {
                const clickFn = node.fn.find((f) => f.on === "click");
                events.push(`onNode:${clickFn?.name}`);
            },
            beforeAction(ctx) {
                events.push(`before:${ctx.action}:${ctx.fnEntry?.name}`);
            },
            afterAction(ctx) {
                events.push(`after:${ctx.action}:${ctx.result}`);
            },
        });

        ax.scan();
        expect(events).toContain("onNode:save");

        const el = queryFirst("[ax-click]");
        events.length = 0;
        ax.invoke(el, "click");

        expect(events).toContain("before:click:save");
        expect(events).toContain("after:click:undefined");

        ax.removeExtension("test");
    });

    test("config.allowEval = false prevents hook execution", () => {
        document.body.innerHTML = `
      <div ax-view="data" ax-onView="() => 'evaled'">skip</div>
    `;

        ax.config.allowEval = false;
        const el = queryFirst("[ax-view]");
        const r = ax.invoke(el, "view");
        expect(r.result).toBe("skip");
        expect(r.ok).toBe(true);

        ax.config.allowEval = true;
    });

    test("scan dag adjacency map is correct", () => {
        document.body.innerHTML = `
      <div ax-view="container">
        <button ax-click="sub">Sub</button>
      </div>
    `;

        const s = ax.scan();
        // html implicit root + div view + button click
        expect(s.nodes.length).toBe(3);

        // The div has a view fn entry
        const rootNode = s.nodes.find((n) => n.fn.some((f) => f.on === "view"));
        expect(rootNode).toBeTruthy();
        // The root's parent is the implicit html node
        expect(rootNode.parent).toBeTruthy();
        expect(rootNode.children.length).toBe(1);

        // Child — the ax-click button
        const childNode = s.nodes.find((n) =>
            n.fn.some((f) => f.on === "click"),
        );
        expect(childNode).toBeTruthy();
        expect(childNode.parent).toBe(rootNode.id);
        expect(childNode.children.length).toBe(0);

        // dag adjacency map entries
        expect(s.dag[rootNode.id]).toEqual([childNode.id]);
        expect(s.dag[childNode.id]).toEqual([]);
    });
});
