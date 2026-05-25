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

    const knownFns = [
        "validateForm",
        "submitRegistration",
        "handleSubmitResult",
        "getField",
    ];
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
 * Returns a structure with stable keys: `{ nodes, dag }`.
 */
function normalizeDAG(scan, ref) {
    // Build key mapping: actual key → alias
    const refAliases = new Map(
        ref.nodes.map((n) => {
            // Create a fingerprint from fn entries
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
        // For the root node with empty fn, use the root alias
        if (n.fn.length === 0 && n.parent === null) {
            keyMap.set(n.id, "$root");
        }
    }
    // Fallback: parent=null with fn=[] is the root
    for (const n of scan.nodes) {
        if (!keyMap.has(n.id) && n.fn.length === 0 && n.parent === null) {
            keyMap.set(n.id, "$root");
        }
    }

    // Map nodes
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

    // Map dag
    const dag = {};
    for (const [k, v] of Object.entries(scan.dag)) {
        const alias = keyMap.get(k);
        if (alias) {
            dag[alias] = v.map((c) => keyMap.get(c) || c).sort();
        }
    }

    return { nodes, dag };
}

describe("personal-info-form", () => {
    /** @type {any} */
    let reference;

    beforeAll(() => {
        reference = loadReference("tests/assets/personal-info-form.dag.json");
    });

    beforeEach(() => {
        ax.config.allowEval = true;
    });

    // ── Compiled DAG shape against reference ───────────────────────

    test("compiled DAG matches expected reference shape", () => {
        loadAsset("tests/assets/personal-info-form.html");
        const scan = ax.scan();
        const actual = normalizeDAG(scan, reference);

        // Compare full scan output against reference (dag + nodes)
        expect(actual.dag).toEqual(reference.dag);

        // Compare nodes (sorted by key for deterministic order)
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
    });

    test("dag adjacency map reflects tree structure", () => {
        loadAsset("tests/assets/personal-info-form.html");
        const scan = ax.scan();
        const actual = normalizeDAG(scan, reference);

        // Every node's children match dag entries
        for (const n of actual.nodes) {
            const dagChildren = (actual.dag[n.id] || []).sort();
            expect(dagChildren).toEqual([...n.children].sort());
        }

        // Leaf nodes have empty dag entries
        const leaves = actual.nodes.filter((n) => n.children.length === 0);
        for (const leaf of leaves) {
            expect(actual.dag[leaf.id]).toEqual([]);
        }
    });

    test("ctx.scope is correct when invoking elements under ax-ctx", () => {
        loadAsset("tests/assets/personal-info-form.html");
        ax.scan();

        const scopes = [];
        ax.defineExtension("scopeTracker", {
            beforeAction(ctx) {
                scopes.push(ctx.scope);
            },
        });

        // Invoke the submit button inside the signup scope
        ax.invoke($("[ax-click='submit registration']"), "click");

        expect(scopes).toContain("signup");
    });

    test("ax-ignore subtree is absent from DAG", () => {
        loadAsset("tests/assets/personal-info-form.html");
        const scan = ax.scan();
        const names = scan.nodes.flatMap((n) => n.fn.map((f) => f.name));
        expect(names).not.toContain("website");
    });

    // ── Hook Lifecycle ──────────────────────────────────────────────

    test("before hook cancels invoke when validation fails (empty form)", () => {
        loadAsset("tests/assets/personal-info-form.html");
        ax.scan();

        const result = ax.invoke(
            $("[ax-click='submit registration']"),
            "click",
        );

        expect(result.canceled).toBe(true);
        expect(result.ok).toBe(false);
        expect(result.result).toBeUndefined();
    });

    test("before hook cancels invoke on invalid email", () => {
        loadAsset("tests/assets/personal-info-form.html");
        ax.scan();

        const firstName = /** @type {HTMLInputElement} */ (
            $("[ax-edit='first name']")
        );
        const lastName = /** @type {HTMLInputElement} */ (
            $("[ax-edit='last name']")
        );
        const email = /** @type {HTMLInputElement} */ ($("[ax-edit='email']"));
        const country = /** @type {HTMLSelectElement} */ (
            $("[ax-edit='country']")
        );
        const password = /** @type {HTMLInputElement} */ (
            $("[ax-edit='password']")
        );
        const confirmPw = /** @type {HTMLInputElement} */ (
            $("[ax-edit='confirm password']")
        );

        firstName.value = "Jane";
        lastName.value = "Doe";
        email.value = "not-an-email";
        country.value = "US";
        password.value = "secret123";
        confirmPw.value = "secret123";

        const result = ax.invoke(
            $("[ax-click='submit registration']"),
            "click",
        );
        expect(result.canceled).toBe(true);
        expect(result.ok).toBe(false);
    });

    test("before hook cancels on password mismatch", () => {
        loadAsset("tests/assets/personal-info-form.html");
        ax.scan();

        const firstName = /** @type {HTMLInputElement} */ (
            $("[ax-edit='first name']")
        );
        const lastName = /** @type {HTMLInputElement} */ (
            $("[ax-edit='last name']")
        );
        const email = /** @type {HTMLInputElement} */ ($("[ax-edit='email']"));
        const country = /** @type {HTMLSelectElement} */ (
            $("[ax-edit='country']")
        );
        const password = /** @type {HTMLInputElement} */ (
            $("[ax-edit='password']")
        );
        const confirmPw = /** @type {HTMLInputElement} */ (
            $("[ax-edit='confirm password']")
        );

        firstName.value = "Jane";
        lastName.value = "Doe";
        email.value = "jane@example.com";
        country.value = "US";
        password.value = "secret123";
        confirmPw.value = "different";

        const result = ax.invoke(
            $("[ax-click='submit registration']"),
            "click",
        );
        expect(result.canceled).toBe(true);
        expect(result.ok).toBe(false);
    });

    test("valid form — before hook passes, on hook returns payload", () => {
        loadAsset("tests/assets/personal-info-form.html");
        ax.scan();

        const firstName = /** @type {HTMLInputElement} */ (
            $("[ax-edit='first name']")
        );
        const middleName = /** @type {HTMLInputElement} */ (
            $("[ax-edit='middle name']")
        );
        const lastName = /** @type {HTMLInputElement} */ (
            $("[ax-edit='last name']")
        );
        const email = /** @type {HTMLInputElement} */ ($("[ax-edit='email']"));
        const phone = /** @type {HTMLInputElement} */ ($("[ax-edit='phone']"));
        const country = /** @type {HTMLSelectElement} */ (
            $("[ax-edit='country']")
        );
        const marketingConsent = /** @type {HTMLInputElement} */ (
            $("[ax-edit='marketing consent']")
        );
        const password = /** @type {HTMLInputElement} */ (
            $("[ax-edit='password']")
        );
        const confirmPw = /** @type {HTMLInputElement} */ (
            $("[ax-edit='confirm password']")
        );

        firstName.value = "Jane";
        middleName.value = "Marie";
        lastName.value = "Doe";
        email.value = "jane@example.com";
        phone.value = "+1 555 123 4567";
        country.value = "US";
        marketingConsent.checked = true;
        password.value = "secret123";
        confirmPw.value = "secret123";

        const result = ax.invoke(
            $("[ax-click='submit registration']"),
            "click",
        );

        expect(result.canceled).toBeFalsy();
        expect(result.ok).toBe(true);
        expect(result.result).toBeTruthy();
        expect(result.result.firstName).toBe("Jane");
        expect(result.result.middleName).toBe("Marie");
        expect(result.result.lastName).toBe("Doe");
        expect(result.result.email).toBe("jane@example.com");
        expect(result.result.phone).toBe("+1 555 123 4567");
        expect(result.result.country).toBe("US");
        expect(result.result.marketingConsent).toBe(true);
    });

    test("after hook executes after on hook", () => {
        loadAsset("tests/assets/personal-info-form.html");
        ax.scan();

        /** @type {string[]} */
        const phases = [];
        ax.defineExtension("lifecycleTracker", {
            afterAction(ctx) {
                phases.push(`after:${ctx.action}:${ctx.scope}`);
            },
        });

        const firstName = /** @type {HTMLInputElement} */ (
            $("[ax-edit='first name']")
        );
        const lastName = /** @type {HTMLInputElement} */ (
            $("[ax-edit='last name']")
        );
        const email = /** @type {HTMLInputElement} */ ($("[ax-edit='email']"));
        const country = /** @type {HTMLSelectElement} */ (
            $("[ax-edit='country']")
        );
        const password = /** @type {HTMLInputElement} */ (
            $("[ax-edit='password']")
        );
        const confirmPw = /** @type {HTMLInputElement} */ (
            $("[ax-edit='confirm password']")
        );

        firstName.value = "Jane";
        lastName.value = "Doe";
        email.value = "jane@example.com";
        country.value = "US";
        password.value = "secret123";
        confirmPw.value = "secret123";

        ax.invoke($("[ax-click='submit registration']"), "click");

        expect(phases.length).toBeGreaterThanOrEqual(1);
        expect(phases[0]).toBe("after:click:signup");
    });

    test("before hook cancel stops on and after hooks", () => {
        loadAsset("tests/assets/personal-info-form.html");
        ax.scan();

        /** @type {string[]} */
        const phases = [];
        ax.defineExtension("cancelTracker", {
            beforeAction(ctx) {
                phases.push(`before:${ctx.action}`);
            },
            onAction(ctx) {
                phases.push(`on:${ctx.action}`);
            },
            afterAction(ctx) {
                phases.push(`after:${ctx.action}`);
            },
        });

        const result = ax.invoke(
            $("[ax-click='submit registration']"),
            "click",
        );
        expect(result.canceled).toBe(true);

        expect(phases).toContain("before:click");
        expect(phases).not.toContain("on:click");
        expect(phases).not.toContain("after:click");
    });
});
