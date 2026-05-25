/**
 * Generate golden DAG reference files for test assets.
 *
 * Usage: bun scripts/generate-golden.mjs [--all | <asset-name>]
 *
 * Reads an HTML asset file, runs ax.scan(), maps dynamic ids to stable
 * aliases based on fn fingerprint, and writes the normalized DAG to
 * tests/assets/<asset-name>.dag.json.
 */

import { readFileSync, writeFileSync } from "fs";
import { JSDOM } from "jsdom";
import { resolve } from "path";

// ── Config ──────────────────────────────────────────────────

const ASSETS_DIR = "tests/assets";

const ASSETS = {
    "personal-info-form": "tests/assets/personal-info-form.html",
    "search-results": "tests/assets/search-results.html",
    "dashboard": "tests/assets/dashboard.html",
    "inline-edit-table": "tests/assets/inline-edit-table.html",
};

// ── JSDOM / ax setup ────────────────────────────────────────

function setupDOM(htmlPath) {
    const html = readFileSync(htmlPath, "utf8");
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

    // Hoist page-level functions so ax eval hooks can resolve them
    const knownFns = [
        "validateForm", "submitRegistration", "handleSubmitResult", "getField",
        "submitSearch",
        "fetchLatestData", "formatCurrency", "normalizeTrend",
        "applyDateFilter", "exportCSV", "checkQuota",
        "editRow10234",
    ];
    const scriptSrc = (html.match(/<script>([\s\S]*?)<\/script>/) || [])[1];
    if (scriptSrc) {
        try { dom.window.eval(scriptSrc); } catch {}
        for (const name of knownFns) {
            const val = dom.window[name];
            if (typeof val === "function") globalThis[name] = val;
        }
    }

    return dom;
}

/**
 * Build a stable alias map from a scan's nodes, keyed by fn fingerprint.
 * For the root node (empty fn), uses "$root".
 */
function buildAliasMap(scan) {
    /** @type {Map<string, string>} */
    const aliasMap = new Map();
    let counter = 1;

    for (const n of scan.nodes) {
        if (n.fn.length === 0 && n.parent === null) {
            aliasMap.set(n.id, "$root");
            continue;
        }
        const sig = n.fn.map((f) => `${f.on}:${f.name}`).sort().join("|");
        // Use fn-name-based aliases where possible
        const firstFn = n.fn[0];
        if (firstFn) {
            const base = firstFn.name
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-|-$/g, "");
            // Check for collisions
            if (![...aliasMap.values()].includes(`$${base}`)) {
                aliasMap.set(n.id, `$${base}`);
                continue;
            }
        }
        // Fallback: numbered placeholder
        aliasMap.set(n.id, `$${counter++}`);
    }

    return aliasMap;
}

/**
 * Normalize a scan result: replace dynamic ids with stable aliases.
 */
function normalizeScan(scan, aliasMap) {
    const dag = {};
    for (const [k, v] of Object.entries(scan.dag)) {
        const alias = aliasMap.get(k);
        if (alias) {
            dag[alias] = v
                .map((c) => aliasMap.get(c) || c)
                .sort();
        }
    }

    const nodes = scan.nodes.map((n) => ({
        id: aliasMap.get(n.id) || n.id,
        parent: n.parent ? aliasMap.get(n.parent) || n.parent : null,
        children: n.children
            .map((c) => aliasMap.get(c) || c)
            .sort(),
        fn: n.fn.map((f) => {
            const entry = { on: f.on, name: f.name };
            if (f.args) entry.args = f.args;
            return entry;
        }),
    }));

    return { dag, nodes };
}

// ── Main ────────────────────────────────────────────────────

function generate(name, htmlPath) {
    const dom = setupDOM(htmlPath);

    // Import ax after DOM setup so jsdom globals are in place
    const ax = require("../src/index.js").default || require("../src/index.js");

    ax.config.allowEval = true;
    const scan = ax.scan();
    const aliasMap = buildAliasMap(scan);
    const normalized = normalizeScan(scan, aliasMap);

    const outPath = resolve(htmlPath).replace(/\.html$/, ".dag.json");
    writeFileSync(outPath, JSON.stringify(normalized, null, 2) + "\n");
    console.log(`Wrote ${outPath}`);
}

// ── CLI ─────────────────────────────────────────────────────

const arg = process.argv[2];

if (!arg || arg === "--all") {
    for (const [name, path] of Object.entries(ASSETS)) {
        generate(name, path);
    }
} else if (ASSETS[arg]) {
    generate(arg, ASSETS[arg]);
} else {
    console.error(`Unknown asset: ${arg}`);
    console.error(`Available: ${Object.keys(ASSETS).join(", ")}`);
    process.exit(1);
}
