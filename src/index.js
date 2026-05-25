/**
 * AX core
 *
 * DOM annotations → tree-based DAG.
 * Only ax-annotated elements are nodes. The tree is the relational map.
 * Native HTML attributes are the contract — ax derives args from the DOM.
 */

/** @typedef {"click" | "view" | "edit" | "nav" | string} AxFnKind */

/**
 * @typedef {Object} AxConfig
 * @property {boolean} allowEval
 */

/**
 * @typedef {Object} AxHookSet
 * @property {string | undefined} before
 * @property {string | undefined} on
 * @property {string | undefined} after
 */

/**
 * A function descriptor in the compiled DAG.
 * `on` is the primitive kind, `name` is the human label.
 * `args` is a schema derived from HTML native attributes (edit/ext).
 * @typedef {Object} AxFnEntry
 * @property {AxFnKind} on
 * @property {string} name
 * @property {Record<string, string> | undefined} [args]
 */

/**
 * A node in the internal tree.
 * @typedef {Object} InternalNode
 * @property {string} id
 * @property {Element} el
 * @property {AxFnEntry[]} fn
 * @property {InternalNode | null} _parent
 * @property {InternalNode[]} _children
 * @property {string} scope
 * @property {Record<string, string>} attrs
 */

/**
 * Serialized node in scan output. `parent` and `children` are key refs.
 * @typedef {Object} AxNode
 * @property {string} id
 * @property {string | null} parent
 * @property {string[]} children
 * @property {AxFnEntry[]} fn
 */

/**
 * @typedef {Object} AxScan
 * @property {number} version
 * @property {number} generatedAt
 * @property {Record<string, string[]>} dag
 * @property {AxNode[]} nodes
 */

/**
 * @typedef {Object} AxInvokeResult
 * @property {boolean} ok
 * @property {boolean} [canceled]
 * @property {any} [result]
 * @property {string} [error]
 */

/**
 * @typedef {Object} AxInvokeContext
 * @property {"before" | "on" | "after"} phase
 * @property {string} action
 * @property {string | undefined} scope
 * @property {Element} el
 * @property {any} args
 * @property {AxScan | null} scan
 * @property {AxFnEntry | undefined} fnEntry
 * @property {AxHookSet} hooks
 * @property {boolean} canceled
 * @property {any} result
 * @property {string | undefined} [error]
 */

/**
 * @typedef {Object} AxExtensionApi
 * @property {(attr: string, def: { kind: AxFnKind }) => void} definePrimitive
 * @property {() => AxScan | null} getScan
 */

/**
 * @typedef {Object} AxExtension
 * @property {(api: AxExtensionApi) => void} [init]
 * @property {(ctx: { root: Element, scan: AxScan }) => void} [onScanStart]
 * @property {(ctx: { node: AxNode, element: Element, scan: AxScan }) => void} [onNode]
 * @property {(ctx: { root: Element, scan: AxScan }) => void} [onScanEnd]
 * @property {(ctx: AxInvokeContext) => void} [beforeAction]
 * @property {(ctx: AxInvokeContext) => any} [onInvoke]
 * @property {(ctx: AxInvokeContext) => void} [afterAction]
 */

/** @type {Map<string, AxFnKind>} */
const PRIMITIVE_KINDS = new Map([
    ["ax-view", "view"],
    ["ax-click", "click"],
    ["ax-edit", "edit"],
    ["ax-nav", "nav"],
]);

/** @type {Map<string, AxExtension>} */
const extensions = new Map();

/** @type {AxScan | null} */
let lastScan = null;

/** @type {WeakMap<Element, string>} */
let elementToId = new WeakMap();

/** @type {WeakMap<Element, string>} */
let elementToScope = new WeakMap();

/** @type {MutationObserver | null} */
let domWatcher = null;

let version = 0;

/** @type {AxConfig} */
const axConfig = {
    allowEval: true,
};

/** @type {AxConfig} */
const config = axConfig;

// ── Helpers ────────────────────────────────────────────────────

/**
 * Get or assign a stable id for an element during scan.
 * Uses `el.id` when available, warns on duplicate ids, falls back to generated key.
 * @param {Element} el
 * @param {Set<string>} seenIds - per-scan set of already-claimed ids
 * @returns {string}
 */
function getOrAssignId(el, seenIds) {
    if (el.id) {
        if (seenIds.has(el.id)) {
            console.warn(
                `ax: duplicate id "${el.id}" on <${el.tagName.toLowerCase()}>, generating fallback`,
            );
            const id = `ax-${version}-${Math.random().toString(36).slice(2, 8)}`;
            elementToId.set(el, id);
            return id;
        }
        seenIds.add(el.id);
        return el.id;
    }
    const existing = elementToId.get(el);
    if (existing) return existing;
    const id = `ax-${version}-${Math.random().toString(36).slice(2, 8)}`;
    elementToId.set(el, id);
    return id;
}

/**
 * @param {Element} el
 * @returns {Record<string, string>}
 */
function readAXAttrs(el) {
    /** @type {Record<string, string>} */
    const out = {};
    const names = el.getAttributeNames();
    for (const name of names) {
        if (!name.startsWith("ax-")) continue;
        const value = el.getAttribute(name);
        out[name] = value === null ? "" : value;
    }
    return out;
}

/**
 * Read primitive entries (ax-view, ax-edit, ax-click, ax-nav) from attrs.
 * @param {Record<string, string>} attrs
 * @returns {{ attr: string, kind: AxFnKind, name: string }[]}
 */
function readPrimitiveEntries(attrs) {
    /** @type {{ attr: string, kind: AxFnKind, name: string }[]} */
    const entries = [];
    for (const attr of Object.keys(attrs)) {
        const kind = PRIMITIVE_KINDS.get(attr);
        if (!kind) continue;
        const raw = attrs[attr];
        if (raw === undefined) continue;
        const name = raw.trim();
        if (!name) {
            throw new Error(`${attr} requires a non-empty value`);
        }
        entries.push({ attr, kind, name });
    }
    return entries;
}

/**
 * @param {Element} el
 * @returns {boolean}
 */
function isUnderIgnore(el) {
    /** @type {Element | null} */
    let node = el;
    while (node) {
        if (
            node.hasAttribute("ax-ignore") ||
            node.hasAttribute("data-ax-ignore")
        )
            return true;
        node = node.parentElement;
    }
    return false;
}

/**
 * Derive input type from native HTML attributes.
 * @param {Element} el
 * @returns {string | undefined}
 */
function inferInputType(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === "textarea") return "textarea";
    if (tag === "select") return "select";
    if (tag === "input") {
        const type = el.getAttribute("type");
        return (type || "text").toLowerCase();
    }
    return undefined;
}

/**
 * Read hook set from attributes for a given capability kind.
 * @param {Record<string, string>} attrs
 * @param {AxFnKind} kind
 * @returns {AxHookSet}
 */
function readHooks(attrs, kind) {
    /** @type {AxHookSet} */
    const hooks = {};
    const suffix = kind.charAt(0).toUpperCase() + kind.slice(1);
    const on =
        attrs[`ax-on${suffix}`] ||
        attrs[`data-ax-on${suffix}`] ||
        attrs[`ax-on${kind}`] ||
        attrs[`data-ax-on${kind}`];
    const before =
        attrs[`ax-before${suffix}`] ||
        attrs[`data-ax-before${suffix}`] ||
        attrs[`ax-before${kind}`] ||
        attrs[`data-ax-before${kind}`];
    const after =
        attrs[`ax-after${suffix}`] ||
        attrs[`data-ax-after${suffix}`] ||
        attrs[`ax-after${kind}`] ||
        attrs[`data-ax-after${kind}`];
    attrs[`ax-after-${kind}`] ||
        attrs[`ax-after${kind.charAt(0).toUpperCase() + kind.slice(1)}`];
    if (before) hooks.before = before;
    if (on) hooks.on = on;
    if (after) hooks.after = after;
    return hooks;
}

/**
 * Evaluate a hook string with HTMX-style eval.
 * @param {string} raw
 * @param {AxInvokeContext} ctx
 * @returns {any}
 */
function evalHook(raw, ctx) {
    if (!config.allowEval) {
        throw new Error("ax.config.allowEval is false — cannot evaluate hook");
    }
    try {
        const fn = new Function("ctx", `return (${raw})(ctx);`);
        return fn(ctx);
    } catch (e) {
        throw new Error(
            `ax hook eval error: ${e instanceof Error ? e.message : String(e)}`,
        );
    }
}

/**
 * Build args for an edit fn entry from native DOM attributes.
 * Only meaningful for input-like elements (input, select, textarea).
 * For container elements (form, div), returns empty — aggregation from
 * children fills the schema.
 * @param {Element} el
 * @returns {Record<string, string>}
 */
function editFieldArgs(el) {
    const name = el.getAttribute("ax-edit");
    if (!name) return {};
    const tag = el.tagName.toLowerCase();
    // Only produce field-level args for actual input-like elements
    if (tag !== "input" && tag !== "select" && tag !== "textarea") {
        return {};
    }
    const type = inferInputType(el) || "text";
    const required = el.hasAttribute("required") ? "" : "?";
    return { [name.trim()]: type + required };
}

/**
 * Collect all edit field args from a node's descendant subtree.
 * Skips the current node's own edit entry — only merges from children.
 * @param {InternalNode} node
 * @returns {Record<string, string> | undefined}
 */
function collectEditArgs(node) {
    /** @type {Record<string, string>} */
    const merged = {};
    let count = 0;

    /**
     * @param {InternalNode} n
     */
    function walkNode(n) {
        /** @type {AxFnEntry | undefined} */
        const editFn = n.fn.find(
            /** @param {AxFnEntry} f */ (f) => f.on === "edit",
        );
        if (editFn && editFn.args) {
            Object.assign(merged, editFn.args);
            count += Object.keys(editFn.args).length;
        }
        for (const child of n._children) {
            walkNode(child);
        }
    }

    // Start from children, skip the node itself
    for (const child of node._children) {
        walkNode(child);
    }

    return count > 0 ? merged : undefined;
}

// ── Scan ───────────────────────────────────────────────────────

/**
 * Walk the DOM and build the internal node tree, then serialize.
 * Only ax-annotated elements become nodes (plus `<html>` as implicit root
 * and elements with `ax-ctx` as scope boundaries).
 * Non-ax elements are transparent — their ax children attach to the
 * nearest ax ancestor.
 * @param {Element} [root]
 * @returns {AxScan}
 */
function scan(root) {
    const r = root || document.documentElement;
    if (!r) {
        return {
            version: ++version,
            generatedAt: Date.now(),
            dag: {},
            nodes: [],
        };
    }

    // Temporary scan for extension hooks during building
    /** @type {AxScan} */
    const buildScan = { version: 0, generatedAt: 0, dag: {}, nodes: [] };

    // Track seen ids within this scan to warn on duplicates
    /** @type {Set<string>} */
    const seenIds = new Set();

    for (const ext of extensions.values()) {
        ext.onScanStart?.({ root: r, scan: buildScan });
    }

    // ── Build internal node tree ──

    /** @type {Map<Element, InternalNode>} */
    const nodeMap = new Map();
    const localKeyMap = new Map();

    /**
     * Walk the DOM, creating InternalNode for each ax element.
     * Non-ax elements are transparent — children climb to nearest ax ancestor.
     * @param {Element} el - current DOM element
     * @param {InternalNode | null} parent - nearest ax ancestor
     * @param {string} scope - current scope name
     * @param {boolean} ignore - whether subtree is ax-ignored
     */
    function walk(el, parent, scope, ignore) {
        if (ignore || isUnderIgnore(el)) {
            // Still recurse for scope boundaries that may override ignore?
            // No — ax-ignore means entire subtree is excluded.
            return;
        }

        const attrs = readAXAttrs(el);
        const entries = readPrimitiveEntries(attrs);

        const ctxAttr = attrs["ax-ctx"];
        const elScope = ctxAttr && ctxAttr.trim() ? ctxAttr.trim() : scope;

        // Determine if this element should be a tree node.
        // It's a node if: it has primitives, or it has ax-ctx, or it's <html>
        const isHtml = el === r;
        const isScopeBoundary = ctxAttr !== undefined && ctxAttr.trim() !== "";
        const hasPrimitives = entries.length > 0;

        /** @type {InternalNode | null} */
        let node = null;

        if (isHtml || isScopeBoundary || hasPrimitives) {
            const id = getOrAssignId(el, seenIds);
            localKeyMap.set(el, id);

            /** @type {AxFnEntry[]} */
            const fn = [];

            // Build fn entries from primitives
            for (const entry of entries) {
                /** @type {AxFnEntry} */
                const f = { on: entry.kind, name: entry.name };

                // For edit, derive args from native DOM attributes
                if (entry.kind === "edit") {
                    f.args = editFieldArgs(el);
                }

                fn.push(f);
            }

            node = {
                id,
                el,
                fn,
                _parent: null,
                _children: [],
                scope: elScope,
                attrs,
            };
            elementToScope.set(el, elScope);

            // Link to parent
            if (parent) {
                node._parent = parent;
                parent._children.push(node);
            }

            nodeMap.set(el, node);

            // Build serialized node for extension hooks
            const serializedNode = {
                id: node.id,
                parent: node._parent ? node._parent.id : null,
                children: [],
                fn: node.fn,
            };
            buildScan.nodes.push(serializedNode);
            buildScan.dag[node.id] = [];
            for (const ext of extensions.values()) {
                ext.onNode?.({
                    node: serializedNode,
                    element: el,
                    scan: buildScan,
                });
            }
            // Change parent for descendants — new scope depth starts here
            parent = node;
        }

        // Track scope for children
        const childScope = ctxAttr && ctxAttr.trim() ? ctxAttr.trim() : scope;

        // Recurse children (only element children, not text nodes)
        for (const child of Array.from(el.children)) {
            walk(child, parent, childScope, ignore);
        }

        // ── Post-order: aggregate edit args ──
        // After all children walked, merge descendant edit args into
        // the parent node's edit fn entry.
        if (node) {
            const editFn = node.fn.find((f) => f.on === "edit");
            if (editFn && node._children.length > 0) {
                const aggregated = collectEditArgs(node);
                if (aggregated) {
                    editFn.args = aggregated;
                }
            }
        }
    }

    walk(r, null, "__root__", false);

    // ── Finalize parent/children refs on serialized nodes ──
    // (Nodes were already serialized during walk for extension hooks.)
    for (const [el, internal] of nodeMap) {
        const serialized = /** @type {AxNode} */ (
            buildScan.nodes.find((n) => n.id === internal.id)
        );
        if (serialized) {
            serialized.parent = internal._parent ? internal._parent.id : null;
            serialized.children = internal._children.map((c) => c.id);
        }
        buildScan.dag[internal.id] = internal._children.map((c) => c.id);
    }

    const result = {
        version: ++version,
        generatedAt: Date.now(),
        dag: buildScan.dag,
        nodes: buildScan.nodes,
    };

    for (const ext of extensions.values()) {
        ext.onScanEnd?.({ root: r, scan: result });
    }

    lastScan = result;
    elementToId = localKeyMap;
    return result;
}

/**
 * Alias.
 * @param {Element} [root]
 * @returns {AxScan}
 */
function process(root) {
    return scan(root);
}

// ── Invoke ─────────────────────────────────────────────────────

/**
 * @param {Element} el
 * @param {AxScan} scan
 * @returns {boolean}
 */
function elementInScan(el, scan) {
    const id = elementToId.get(el);
    if (!id) return false;
    return scan.nodes.some((n) => n.id === id);
}

/**
 * Find a node's fn entry by name and action type.
 * @param {AxNode[]} nodes
 * @param {Element} el
 * @param {string} action
 * @returns {{ node: AxNode | undefined, fn: AxFnEntry | undefined }}
 */
function findFn(nodes, el, action) {
    // Need element-to-id mapping from the last scan
    // We use the persistent elementToId WeakMap
    const id = elementToId.get(el);
    if (!id) return { node: undefined, fn: undefined };
    const node = nodes.find((n) => n.id === id);
    if (!node) return { node: undefined, fn: undefined };
    const fn = node.fn.find((f) => f.on === action);
    return { node, fn };
}

/**
 * @param {string | Element | undefined} scopeOrEl
 * @param {Element | string | undefined} elOrAction
 * @param {string | any | undefined} actionOrArgs
 * @param {any} [args]
 * @returns {AxInvokeResult}
 */
function invoke(scopeOrEl, elOrAction, actionOrArgs, args) {
    /** @type {string | undefined} */
    let scope;
    /** @type {Element | undefined} */
    let el;
    /** @type {string | undefined} */
    let action;
    /** @type {any} */
    let payloadArgs;

    if (
        scopeOrEl &&
        typeof scopeOrEl === "object" &&
        scopeOrEl instanceof Element
    ) {
        el = scopeOrEl;
        action = /** @type {string} */ (elOrAction);
        payloadArgs = actionOrArgs;
    } else {
        if (typeof scopeOrEl === "string") scope = scopeOrEl;
        el = /** @type {Element} */ (elOrAction);
        action = /** @type {string} */ (actionOrArgs);
        payloadArgs = args;
    }

    if (!el) {
        return { ok: false, error: "No target element provided" };
    }
    if (!action) {
        return { ok: false, error: "No action provided" };
    }

    // Scan fresh if stale or element not in current scan
    if (!lastScan || !elementToId.has(el)) {
        scan(document.body);
    }

    const currentScan = lastScan;
    if (!currentScan || !currentScan.dag) {
        return { ok: false, error: "No scan data available" };
    }

    // Find fn entry for this element + action
    const { node: nodeEntry, fn: fnEntry } = findFn(
        currentScan.nodes,
        el,
        action,
    );

    if (!fnEntry) {
        return invokeDefault(el, action, payloadArgs);
    }

    // Resolve scope from the element's node position
    let resolvedScope = scope || elementToScope.get(el) || "__root__";

    // Read hooks from the element's attrs for this action
    const attrs = readAXAttrs(el);
    const hooks = readHooks(attrs, /** @type {AxFnKind} */ (action));

    /** @type {AxInvokeContext} */
    const ctx = {
        phase: "before",
        action,
        scope: resolvedScope,
        el,
        args: payloadArgs ?? {},
        scan: currentScan,
        fnEntry,
        hooks,
        canceled: false,
        result: undefined,
    };

    // ── Before lifecycle ──
    for (const ext of extensions.values()) {
        ext.beforeAction?.(ctx);
    }
    if (ctx.canceled) {
        return {
            ok: false,
            canceled: true,
            result: undefined,
            ...(ctx.error ? { error: ctx.error } : {}),
        };
    }

    const beforeResult = executeHook("before", hooks.before, ctx);
    if (beforeResult !== undefined && beforeResult === false) {
        return {
            ok: false,
            canceled: true,
            result: undefined,
            ...(ctx.error ? { error: ctx.error } : {}),
        };
    }

    // ── On lifecycle ──
    ctx.phase = "on";
    let onResult;
    let override = false;

    for (const ext of extensions.values()) {
        if (ext.onInvoke) {
            const r = ext.onInvoke(ctx);
            if (r !== undefined) {
                onResult = r;
                override = true;
            }
        }
    }

    if (!override) {
        onResult = executeHook("on", hooks.on, ctx);
        if (onResult === undefined && !ctx.error) {
            onResult = executeDefault(el, action, payloadArgs);
        }
    }

    ctx.result = onResult;

    // ── After lifecycle ──
    ctx.phase = "after";
    executeHook("after", hooks.after, ctx);

    for (const ext of extensions.values()) {
        ext.afterAction?.(ctx);
    }

    return {
        ok: true,
        result: ctx.result,
        ...(ctx.error ? { error: ctx.error } : {}),
    };
}

/**
 * @param {"before" | "on" | "after"} phase
 * @param {string | undefined} raw
 * @param {AxInvokeContext} ctx
 * @returns {any}
 */
function executeHook(phase, raw, ctx) {
    if (!raw) return undefined;
    if (!config.allowEval) return undefined;

    try {
        return evalHook(raw, ctx);
    } catch (e) {
        ctx.error = String(e);
        return undefined;
    }
}

/**
 * @param {Element} el
 * @param {string} action
 * @param {any} args
 * @returns {any}
 */
function executeDefault(el, action, args) {
    if (action === "view") {
        return (el.textContent || "").trim();
    }
    if (action === "click") {
        const clickable = /** @type {{ click?: () => void }} */ (el);
        if (typeof clickable.click === "function") clickable.click();
        return undefined;
    }
    if (
        action === "edit" &&
        args &&
        Object.prototype.hasOwnProperty.call(args, "value")
    ) {
        if (el instanceof HTMLInputElement) {
            const type = (el.type || "text").toLowerCase();
            if (type === "checkbox" || type === "radio") {
                el.checked = Boolean(args.value);
            } else {
                el.value = String(args.value);
            }
        } else if (
            el instanceof HTMLTextAreaElement ||
            el instanceof HTMLSelectElement
        ) {
            el.value = String(args.value);
        }
        return undefined;
    }
    if (action === "nav") {
        if (el instanceof HTMLAnchorElement) {
            return el.getAttribute("href") || el.href;
        }
        const clickable = /** @type {{ click?: () => void }} */ (el);
        if (typeof clickable.click === "function") clickable.click();
        return undefined;
    }
    return undefined;
}

/**
 * @param {Element} el
 * @param {string} action
 * @param {any} args
 * @returns {AxInvokeResult}
 */
function invokeDefault(el, action, args) {
    try {
        const result = executeDefault(el, action, args);
        return { ok: true, result };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}

// ── API ────────────────────────────────────────────────────────

/**
 * @param {string} attr
 * @param {{ kind: AxFnKind }} def
 */
function definePrimitive(attr, def) {
    if (!attr.startsWith("ax-")) {
        throw new Error(`Primitive "${attr}" must start with "ax-"`);
    }
    if (PRIMITIVE_KINDS.has(attr)) {
        throw new Error(`Primitive "${attr}" already exists`);
    }
    PRIMITIVE_KINDS.set(attr, def.kind);
}

/**
 * @param {string} name
 * @param {AxExtension} extension
 */
function defineExtension(name, extension) {
    const api = {
        definePrimitive,
        getScan: () => lastScan,
    };
    extension.init?.(api);
    extensions.set(name, extension);
}

/**
 * @param {string} name
 */
function removeExtension(name) {
    extensions.delete(name);
}

/**
 * Start watching the DOM for mutations that affect ax elements.
 * Invalidates the scan cache so the next invoke or scan is fresh.
 * The harness can optionally provide a callback to be notified.
 * @param {((mutations: MutationRecord[]) => void) | undefined} [callback]
 * @returns {MutationObserver}
 */
function watch(callback) {
    if (domWatcher) domWatcher.disconnect();
    domWatcher = new MutationObserver((mutations) => {
        lastScan = null;
        elementToId = new WeakMap();
        callback?.(mutations);
    });
    domWatcher.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
            "ax-view",
            "ax-edit",
            "ax-click",
            "ax-nav",
            "ax-ctx",
            "ax-ignore",
            "ax-before-click",
            "ax-on-click",
            "ax-after-click",
            "ax-before-view",
            "ax-on-view",
            "ax-after-view",
            "ax-before-edit",
            "ax-on-edit",
            "ax-after-edit",
            "ax-before-nav",
            "ax-on-nav",
            "ax-after-nav",
            "ax-beforeclick",
            "ax-onclick",
            "ax-afterclick",
            "ax-beforeview",
            "ax-onview",
            "ax-afterview",
            "ax-beforeedit",
            "ax-onedit",
            "ax-afteredit",
            "ax-beforenav",
            "ax-onnav",
            "ax-afternav",
        ],
    });
    return domWatcher;
}

/**
 * Stop watching for DOM mutations.
 */
function unwatch() {
    if (domWatcher) {
        domWatcher.disconnect();
        domWatcher = null;
    }
}

const publicAPI = {
    scan,
    process,
    invoke,
    definePrimitive,
    defineExtension,
    removeExtension,
    watch,
    unwatch,
    config: axConfig,
};

export default publicAPI;
