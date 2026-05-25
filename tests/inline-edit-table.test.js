import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { JSDOM } from "jsdom";
import ax from "../src/index.js";

/**
 * Load an asset file and set up a jsdom document from it.
 * Hoists page-defined functions to globalThis so ax's new Function
 * eval (HTMX-style) can resolve them.
 */
function loadAsset(assetPath) {
    const html = readFileSync(assetPath, "utf8");
    const dom = new JSDOM(html, { url: "http://localhost/" });
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.CustomEvent = dom.window.CustomEvent;
    globalThis.Element = dom.window.Element;
    globalThis.HTMLElement = dom.window.HTMLElement;
    globalThis.HTMLInputElement = dom.window.HTMLInputElement;
    globalThis.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
    globalThis.HTMLSelectElement = dom.window.HTMLSelectElement;
    globalThis.HTMLAnchorElement = dom.window.HTMLAnchorElement;
    globalThis.MutationObserver = dom.window.MutationObserver;

    const knownFns = ["editRow10234"];
    const scriptSrc = (html.match(/<script>([\s\S]*?)<\/script>/) || [])[1];
    if (scriptSrc) {
        try {
            dom.window.eval(scriptSrc);
        } catch {}
        for (const name of knownFns) {
            const val = dom.window[name];
            if (typeof val === "function") globalThis[name] = val;
        }
    }
    return { document: dom.window.document, window: dom.window };
}

/** @param {string} q */
function $(q) {
    return /** @type {Element} */ (document.querySelector(q));
}

/** Load reference DAG JSON. */
function loadReference(path) {
    return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * Map a scan result's dynamic keys to stable aliases based on fn names.
 */
function normalizeDAG(scan, ref) {
    const refAliases = new Map(
        ref.nodes.map((n) => {
            const sig = n.fn
                .map((f) => `${f.on}:${f.name}`)
                .sort()
                .join("|");
            return [sig, n.id];
        }),
    );

    /** @type {Map<string, string>} */
    const keyMap = new Map();
    for (const n of scan.nodes) {
        const sig = n.fn
            .map((f) => `${f.on}:${f.name}`)
            .sort()
            .join("|");
        const alias = refAliases.get(sig);
        if (alias) keyMap.set(n.id, alias);
        if (n.fn.length === 0 && n.parent === null) {
            keyMap.set(n.id, "$root");
        }
    }
    for (const n of scan.nodes) {
        if (!keyMap.has(n.id) && n.fn.length === 0 && n.parent === null) {
            keyMap.set(n.id, "$root");
        }
    }

    const nodes = scan.nodes.map((n) => ({
        id: keyMap.get(n.id) || n.id,
        parent: n.parent ? keyMap.get(n.parent) || n.parent : null,
        children: n.children.map((c) => keyMap.get(c) || c).sort(),
        fn: n.fn.map((f) => {
            const entry = { on: f.on, name: f.name };
            if (f.args) entry.args = f.args;
            return entry;
        }),
    }));

    const dag = {};
    for (const [k, v] of Object.entries(scan.dag)) {
        const alias = keyMap.get(k);
        if (alias) {
            dag[alias] = v.map((c) => keyMap.get(c) || c).sort();
        }
    }

    return { nodes, dag };
}

describe("inline-edit-table", () => {
    /** @type {any} */
    let reference;

    beforeAll(() => {
        reference = loadReference("tests/assets/inline-edit-table.dag.json");
    });

    beforeEach(() => {
        ax.config.allowEval = true;
    });

    // ── Initial DAG ────────────────────────────────────────────

    test("initial scan shows view + click on the status cell", () => {
        loadAsset("tests/assets/inline-edit-table.html");
        const scan = ax.scan();
        const actual = normalizeDAG(scan, reference);

        expect(actual.dag).toEqual(reference.dag);

        const refNodes = [...reference.nodes].sort((a, b) =>
            a.id.localeCompare(b.id),
        );
        const actNodes = [...actual.nodes].sort((a, b) =>
            a.id.localeCompare(b.id),
        );
        expect(actNodes.length).toBe(refNodes.length);
        for (let i = 0; i < refNodes.length; i++) {
            expect(actNodes[i]).toEqual(refNodes[i]);
        }

        // The order-status node has both view and click
        const statusNode = actual.nodes.find((n) =>
            n.fn.some((f) => f.name === "order status"),
        );
        expect(statusNode).toBeTruthy();
        expect(statusNode.fn.map((f) => f.on).sort()).toEqual([
            "click",
            "view",
        ]);
    });

    // ── Click → DOM mutation → rescan → edit ───────────────────

    test("click swaps span for select, rescan reveals edit", async () => {
        loadAsset("tests/assets/inline-edit-table.html");
        ax.watch();

        // Initial scan: status cell has view + click
        let scan = ax.scan();
        let statusNode = scan.nodes.find((n) =>
            n.fn.some((f) => f.name === "order status"),
        );
        expect(statusNode.fn.some((f) => f.on === "view")).toBe(true);
        expect(statusNode.fn.some((f) => f.on === "click")).toBe(true);
        expect(statusNode.fn.some((f) => f.on === "edit")).toBe(false);

        // Invoke click on the status cell
        const el = $("[ax-click='editRow10234']");
        const result = ax.invoke(el, "click");

        expect(result.ok).toBe(true);

        // Wait for MutationObserver microtask to fire
        await new Promise((resolve) => setTimeout(resolve, 5));

        // Rescan: now the cell should have an edit capability
        scan = ax.scan();
        statusNode = scan.nodes.find((n) =>
            n.fn.some((f) => f.name === "order status"),
        );
        expect(statusNode).toBeTruthy();
        expect(statusNode.fn.some((f) => f.on === "edit")).toBe(true);
        expect(statusNode.fn.some((f) => f.on === "view")).toBe(false);
        expect(statusNode.fn.some((f) => f.on === "click")).toBe(false);

        // Verify the edit args are present (type from select element)
        const editFn = statusNode.fn.find((f) => f.on === "edit");
        expect(editFn.args).toEqual({ "order status": "select?" });
    });
});
