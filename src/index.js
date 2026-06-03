/**
 * AX core
 *
 * DOM annotations → tree-based DAG.
 * Only ax-annotated elements are nodes. The tree is the relational map.
 * Native HTML attributes are the contract — ax derives args from the DOM.
 *
 * No allocating array methods (find, some, map, filter, reduce, forEach).
 * No Object.keys(). No Array.from().
 * All manual for loops to avoid GC pressure.
 *
 * TODO(iframe): 
 *   iframe/frame elements create boundary nodes in the tree but ax cannot
 *   peer into cross-origin iframes from the top-level content script.
 *   The host extension is responsible for injecting a separate ax instance
 *   into each frame + merging results. This core library should remain
 *   frame-agnostic — the boundary marker is just a signal for the host.
 *   Remove the iframe/frame special-casing in walk() once frame injection
 *   is fully handled by the host.
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
 * @property {string} [tagName]
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

// ── Implementation ─────────────────────────────────────────────

const ax = (function () {
    "use strict";

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
    const elementToScope = new WeakMap();

    /** @type {MutationObserver | null} */
    let domWatcher = null;

    let version = 0;
    let idCounter = 0;

    /** @type {AxConfig} */
    const axConfig = {
        allowEval: true,
    };

    /** @type {AxConfig} */
    const config = axConfig;

    // ── Helpers ────────────────────────────────────────────────────

    /**
     * Compute a hash-based id from element DOM path.
     * @param {Element} el
     * @returns {string}
     */
    function elementPathHash(el) {
        const parts = [];
        let cur = el;
        while (cur && cur !== document.documentElement) {
            const tag = cur.tagName.toLowerCase();
            if (cur.id) {
                parts.unshift("#" + cur.id);
                break;
            }
            let sib = cur;
            let nth = 1;
            while (true) {
                const prev = sib.previousElementSibling;
                if (!prev) break;
                sib = prev;
                if (sib.tagName === cur.tagName) nth++;
            }
            parts.unshift(tag + ":nth-child(" + nth + ")");
            const parent = cur.parentElement;
            if (!parent) break;
            cur = parent;
        }
        const path = parts.join(" > ");
        // djb2 hash
        let hash = 5381;
        for (let i = 0; i < path.length; i++) {
            hash = (hash << 5) + hash + path.charCodeAt(i);
            hash = hash & hash;
        }
        return "ax-" + Math.abs(hash).toString(36);
    }

    /**
     * Get or assign a stable id for an element during scan.
     * Uses `el.id` when available, warns on duplicate ids, falls back to path hash.
     * @param {Element} el
     * @param {Set<string>} seenIds - per-scan set of already-claimed ids
     * @returns {string}
     */
    function getOrAssignId(el, seenIds) {
        if (el.id) {
            if (seenIds.has(el.id)) {
                console.warn(
                    'ax: duplicate id "' +
                        el.id +
                        '" on <' +
                        el.tagName.toLowerCase() +
                        ">, generating fallback",
                );
                let fallback = elementPathHash(el);
                if (seenIds.has(fallback)) {
                    fallback = "ax-" + ++idCounter;
                }
                elementToId.set(el, fallback);
                return fallback;
            }
            seenIds.add(el.id);
            return el.id;
        }
        const existing = elementToId.get(el);
        if (existing) return existing;
        let id = elementPathHash(el);
        // Handle collision — append counter if hash already used this scan
        if (seenIds.has(id)) {
            id = "ax-" + ++idCounter;
        }
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
        let i = 0;
        const len = names.length;
        for (; i < len; i++) {
            const name = names[i];
            const isAx = name.startsWith("ax-");
            const isDataAx = !isAx && name.startsWith("data-ax-");
            if (!isAx && !isDataAx) continue;
            // Normalise data-ax-* → ax-* for internal key lookup
            const key = isDataAx ? name.slice(5) : name;
            out[key] = el.getAttribute(name) || "";
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
        let attr;
        for (attr in attrs) {
            if (!Object.prototype.hasOwnProperty.call(attrs, attr)) continue;
            const kind = PRIMITIVE_KINDS.get(attr);
            if (!kind) continue;
            const raw = attrs[attr];
            if (raw === undefined) continue;
            const name = raw.trim();
            if (!name) {
                throw new Error(attr + " requires a non-empty value");
            }
            entries.push({ attr: attr, kind: kind, name: name });
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
            attrs["ax-on" + suffix] ||
            attrs["data-ax-on" + suffix] ||
            attrs["ax-on" + kind] ||
            attrs["data-ax-on" + kind];
        const before =
            attrs["ax-before" + suffix] ||
            attrs["data-ax-before" + suffix] ||
            attrs["ax-before" + kind] ||
            attrs["data-ax-before" + kind];
        const after =
            attrs["ax-after" + suffix] ||
            attrs["data-ax-after" + suffix] ||
            attrs["ax-after" + kind] ||
            attrs["data-ax-after" + kind];
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
            throw new Error(
                "ax.config.allowEval is false — cannot evaluate hook",
            );
        }
        try {
            const fn = new Function("ctx", "return (" + raw + ")(ctx);");
            return fn(ctx);
        } catch (e) {
            throw new Error(
                "ax hook eval error: " +
                    (e instanceof Error ? e.message : String(e)),
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
        /** @type {Record<string, string>} */
        const obj = {};
        obj[name.trim()] = type + required;
        return obj;
    }

    /**
     * Find first fn entry matching `on` in a node's fn array.
     * Returns the entry or undefined.
     * Manual loop — no find().
     * @param {AxFnEntry[]} fnArr
     * @param {string} on
     * @returns {AxFnEntry | undefined}
     */
    function findFnEntry(fnArr, on) {
        let i = 0;
        const len = fnArr.length;
        for (; i < len; i++) {
            if (fnArr[i].on === on) return fnArr[i];
        }
        return undefined;
    }

    /**
     * Find a node by id in a nodes array.
     * Manual loop — no find().
     * @param {AxNode[]} nodes
     * @param {string} id
     * @returns {AxNode | undefined}
     */
    function findNodeById(nodes, id) {
        let i = 0;
        const len = nodes.length;
        for (; i < len; i++) {
            if (nodes[i].id === id) return nodes[i];
        }
        return undefined;
    }

    /**
     * Check if a node id exists in a nodes array.
     * Manual loop — no some().
     * @param {AxNode[]} nodes
     * @param {string} id
     * @returns {boolean}
     */
    function hasNodeId(nodes, id) {
        let i = 0;
        const len = nodes.length;
        for (; i < len; i++) {
            if (nodes[i].id === id) return true;
        }
        return false;
    }

    /**
     * Collect child ids into an array.
     * Manual loop — no map().
     * @param {InternalNode[]} children
     * @returns {string[]}
     */
    function collectChildIds(children) {
        /** @type {string[]} */
        const ids = [];
        let i = 0;
        const len = children.length;
        for (; i < len; i++) {
            ids.push(children[i].id);
        }
        return ids;
    }

    /**
     * Collect all edit field args from a node's descendant subtree.
     * Skips the current node's own edit entry — only merges from children.
     * @param {InternalNode} node
     * @returns {Record<string, string> | undefined}
     */
    function collectEditArgs(node) {
        /** @type {Record<string, string>} */
        const merged = /** @type {Record<string, string>} */ ({});
        let count = 0;

        /**
         * @param {InternalNode} n
         */
        function walkNode(n) {
            const editFn = findFnEntry(n.fn, "edit");
            if (editFn && editFn.args) {
                for (const k in editFn.args) {
                    if (!Object.prototype.hasOwnProperty.call(editFn.args, k))
                        continue;
                    const val = editFn.args[k];
                    if (val !== undefined) {
                        merged[k] = val;
                        count++;
                    }
                }
            }
            let ci = 0;
            const clen = n._children.length;
            for (; ci < clen; ci++) {
                walkNode(n._children[ci]);
            }
        }

        // Start from children, skip the node itself
        let ci = 0;
        const clen = node._children.length;
        for (; ci < clen; ci++) {
            walkNode(node._children[ci]);
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
    function scan(root, opts) {
        var showHidden = opts && opts.showHidden === true;
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
            if (ext.onScanStart) ext.onScanStart({ root: r, scan: buildScan });
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
                return;
            }

            // Skip hidden/non-interactable elements and their subtrees.
            if (typeof el.checkVisibility === "function" && !el.checkVisibility()) {
                return;
            }
            // Check various computed-style properties that make elements
            // invisible or non-interactable (not covered by checkVisibility).
            if (el !== r) {
                var style = window.getComputedStyle(el);
                if (style.opacity === "0" || style.pointerEvents === "none") {
                    return;
                }
                // Zero-area rect: element has no visible box (e.g. height:0;overflow:hidden)
                if (typeof el.getClientRects === "function") {
                    var rects = el.getClientRects();
                    if (rects.length === 0) {
                        return;
                    }
                    var hasArea = false;
                    for (var ri = 0; ri < rects.length; ri++) {
                        if (rects[ri].width > 0 && rects[ri].height > 0) {
                            hasArea = true;
                            break;
                        }
                    }
                    if (!hasArea) {
                        return;
                    }
                }
            }

            const attrs = readAXAttrs(el);
            const entries = readPrimitiveEntries(attrs);

            const ctxAttr = attrs["ax-ctx"];
            const elScope = ctxAttr && ctxAttr.trim() ? ctxAttr.trim() : scope;

            // Determine if this element should be a tree node.
            // It's a node if: it has primitives, or it has ax-ctx, or it's <html>
            const isHtml = el === r;
            const isScopeBoundary =
                ctxAttr !== undefined && ctxAttr.trim() !== "";
            const hasPrimitives = entries.length > 0;

            // Check if element is effectively invisible.
            // When hidden, we skip creating a tree node but still recurse children
            // through the parent — hidden elements become "transparent" in the tree.
            var hiddenCheck = false;
            if (!isHtml) {
                if (typeof el.checkVisibility === "function" && !el.checkVisibility({ checkVisibilityCSS: true })) {
                    hiddenCheck = true;
                } else if (window.getComputedStyle(el).opacity === "0") {
                    hiddenCheck = true;
                } else if (typeof el.getClientRects === "function") {
                    var rects = el.getClientRects();
                    if (rects.length === 0) {
                        hiddenCheck = true;
                    } else {
                        var hasArea = false;
                        for (var ri = 0; ri < rects.length; ri++) {
                            if (rects[ri].width > 0 && rects[ri].height > 0) {
                                hasArea = true;
                                break;
                            }
                        }
                        if (!hasArea) hiddenCheck = true;
                    }
                }
                // Off-screen elements: positioned outside viewport (e.g. AI Mode header)
                if (!hiddenCheck) {
                    var bbox = el.getBoundingClientRect();
                    if (bbox.bottom < 0 || bbox.right < 0 || bbox.top > window.innerHeight || bbox.left > window.innerWidth) {
                        hiddenCheck = true;
                    }
                }
            }
            var isHidden = showHidden ? false : hiddenCheck;

            // TODO(iframe): iframe/frame elements create boundary marker nodes.
            // The host extension is responsible for injecting ax into frames.
            var isFrame = el.tagName === 'IFRAME' || el.tagName === 'FRAME';

            /** @type {InternalNode | null} */
            let node = null;

            if (isHtml || isScopeBoundary || hasPrimitives || isFrame) {
                if (isHidden) {
                    // Hidden: element is invisible. Children will be linked to the
                    // nearest visible ancestor (no tree node created for this element).
                } else {
                const id = getOrAssignId(el, seenIds);
                localKeyMap.set(el, id);

                /** @type {AxFnEntry[]} */
                const fn = [];

                // Build fn entries from primitives
                let ei = 0;
                const elen = entries.length;
                for (; ei < elen; ei++) {
                    const entry = entries[ei];
                    /** @type {AxFnEntry} */
                    const f = { on: entry.kind, name: entry.name };

                    // For edit, derive args from native DOM attributes
                    if (entry.kind === "edit") {
                        f.args = editFieldArgs(el);
                    }

                    fn.push(f);
                }

                // Include ctx as a fn entry so the tree shows its name
                if (ctxAttr && ctxAttr.trim()) {
                    fn.push({ on: "ctx", name: ctxAttr.trim() });
                } else if (isHtml) {
                    fn.push({ on: "ctx", name: "root" });
                }

                // Frame boundary marker — ax cannot peer into cross-origin frames
                if (isFrame) {
                    const frameName = el.getAttribute('title') || el.getAttribute('src') || el.getAttribute('name') || el.id || 'iframe';
                    fn.push({ on: "frame", name: frameName });
                }

                // Check if element was annotated by autobindgen (has data-ax-bindgen)
                const isBindgen = el.hasAttribute("data-ax-bindgen");

                node = {
                    id: id,
                    el: el,
                    fn: fn,
                    _parent: null,
                    _children: [],
                    scope: elScope,
                    attrs: attrs,
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
                    tagName: el.tagName.toLowerCase(),
                    parent: node._parent ? node._parent.id : null,
                    children: [],
                    fn: node.fn,
                    bindgen: isBindgen,
                };
                buildScan.nodes.push(serializedNode);
                buildScan.dag[node.id] = [];
                for (const ext of extensions.values()) {
                    if (ext.onNode) {
                        ext.onNode({
                            node: serializedNode,
                            element: el,
                            scan: buildScan,
                        });
                    }
                }
                // Change parent for descendants — new scope depth starts here
                parent = node;
            }
            }

            // Track scope for children
            const childScope =
                ctxAttr && ctxAttr.trim() ? ctxAttr.trim() : scope;

            // Recurse children (only element children, not text nodes)
            // Use indexed for loop instead of Array.from() / for-of
            // Skip iframe/frame — their content is a separate document
            if (!isFrame) {
            const childEls = el.children;
            let ci = 0;
            const clen = childEls.length;
            for (; ci < clen; ci++) {
                walk(childEls[ci], parent, childScope, ignore);
            }
            }

            // ── Post-order: aggregate edit args ──
            // After all children walked, merge descendant edit args into
            // the parent node's edit fn entry.
            if (node) {
                const editFn = findFnEntry(node.fn, "edit");
                if (editFn && node._children.length > 0) {
                    const aggregated = collectEditArgs(node);
                    if (aggregated) {
                        editFn.args = aggregated;
                    }
                }

                // Nav/click + view promotion: if a nav/click parent has view children,
                // it should also expose a view entry so the agent can read its content.
                const hasNavClick = node.fn.some(function(f) { return f.on === 'nav' || f.on === 'click'; });
                if (hasNavClick) {
                    // Collect view-only leaf children
                    var viewChildren = [];
                    for (var vi = 0; vi < node._children.length; vi++) {
                        var child = node._children[vi];
                        var isViewOnly = child.fn.length > 0;
                        for (var vfi = 0; vfi < child.fn.length; vfi++) {
                            if (child.fn[vfi].on !== 'view') { isViewOnly = false; break; }
                        }
                        if (isViewOnly && child._children.length === 0) {
                            viewChildren.push(child);
                        }
                    }

                    if (viewChildren.length === 1) {
                        // Exactly one view child → subsume it into parent
                        var subChild = viewChildren[0];
                        for (var afi = 0; afi < subChild.fn.length; afi++) {
                            node.fn.push(subChild.fn[afi]);
                        }
                        var childIdx = node._children.indexOf(subChild);
                        if (childIdx !== -1) node._children.splice(childIdx, 1);
                        var nodeIdx = -1;
                        for (var ni = 0; ni < buildScan.nodes.length; ni++) {
                            if (buildScan.nodes[ni].id === subChild.id) { nodeIdx = ni; break; }
                        }
                        if (nodeIdx !== -1) buildScan.nodes.splice(nodeIdx, 1);
                        delete buildScan.dag[subChild.id];
                    } else if (viewChildren.length > 1) {
                        // Multiple view children → parent gets a view entry too
                        // Derive view name from aria-label or first view child or click name
                        if (!findFnEntry(node.fn, 'view')) {
                            var viewName = el.getAttribute('aria-label') || viewChildren[0].fn[0].name || '';
                            if (viewName) {
                                node.fn.push({ on: 'view', name: viewName });
                            }
                        }
                    }
                }
            }
        }

        walk(r, null, "__root__", false);

        // ── Finalize parent/children refs on serialized nodes ──
        // (Nodes were already serialized during walk for extension hooks.)
        for (const entry of nodeMap) {
            const internal = entry[1];
            const serialized = findNodeById(buildScan.nodes, internal.id);
            if (serialized) {
                serialized.parent = internal._parent
                    ? internal._parent.id
                    : null;
                serialized.children = collectChildIds(internal._children);
            }
            buildScan.dag[internal.id] = collectChildIds(internal._children);
        }

        const result = {
            version: ++version,
            generatedAt: Date.now(),
            dag: buildScan.dag,
            nodes: buildScan.nodes,
        };

        for (const ext of extensions.values()) {
            if (ext.onScanEnd) ext.onScanEnd({ root: r, scan: result });
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
     * Check if an element's id exists in a scan's nodes.
     * Manual loop — no some().
     * @param {Element} el
     * @param {AxScan} scan
     * @returns {boolean}
     */
    function elementInScan(el, scan) {
        const id = elementToId.get(el);
        if (!id) return false;
        return hasNodeId(scan.nodes, id);
    }

    /**
     * Find a node's fn entry by name and action type.
     * Manual loops — no find().
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
        const node = findNodeById(nodes, id);
        if (!node) return { node: undefined, fn: undefined };
        const fn = findFnEntry(node.fn, action);
        return { node: node, fn: fn };
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
        const found = findFn(currentScan.nodes, el, action);
        const nodeEntry = found.node;
        const fnEntry = found.fn;

        if (!fnEntry) {
            return invokeDefault(el, action, payloadArgs);
        }

        // Resolve scope from the element's node position
        const resolvedScope = scope || elementToScope.get(el) || "__root__";

        // Read hooks from the element's attrs for this action
        const attrs = readAXAttrs(el);
        const hooks = readHooks(attrs, /** @type {AxFnKind} */ (action));

        /** @type {AxInvokeContext} */
        const ctx = {
            phase: "before",
            action: action,
            scope: resolvedScope,
            el: el,
            args: payloadArgs ?? {},
            scan: currentScan,
            fnEntry: fnEntry,
            hooks: hooks,
            canceled: false,
            result: undefined,
        };

        // ── Before lifecycle ──
        for (const ext of extensions.values()) {
            if (ext.beforeAction) ext.beforeAction(ctx);
        }
        if (ctx.canceled) {
            /** @type {AxInvokeResult} */
            const beforeCancelResult = {
                ok: false,
                canceled: true,
                result: undefined,
            };
            if (ctx.error) beforeCancelResult.error = ctx.error;
            return beforeCancelResult;
        }

        const beforeResult = executeHook("before", hooks.before, ctx);
        if (beforeResult !== undefined && beforeResult === false) {
            /** @type {AxInvokeResult} */
            const beforeHookCancelResult = {
                ok: false,
                canceled: true,
                result: undefined,
            };
            if (ctx.error) beforeHookCancelResult.error = ctx.error;
            return beforeHookCancelResult;
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
            if (ext.afterAction) ext.afterAction(ctx);
        }

        /** @type {AxInvokeResult} */
        const invokeResult = {
            ok: true,
            result: ctx.result,
        };
        if (ctx.error) invokeResult.error = ctx.error;
        return invokeResult;
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
    /**
     * Simulate user text input by focusing the element, setting its value,
     * and dispatching native input/change events so the page's JS reacts.
     */
    function editTextInput(el, text) {
        el.focus();
        el.value = text;
        el.dispatchEvent(new InputEvent("input", {
            inputType: "insertText",
            data: text,
            bubbles: true,
            composed: true,
        }));
        el.dispatchEvent(new Event("change", {
            bubbles: true,
        }));
    }

    function executeDefault(el, action, args) {
        if (action === "view") {
            return (el.textContent || "").trim();
        }
        if (action === "click") {
            /** @type {{ click?: () => void }} */
            const clickable = /** @type {any} */ (el);
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
                    editTextInput(el, String(args.value));
                }
            } else if (el instanceof HTMLTextAreaElement) {
                editTextInput(el, String(args.value));
            } else if (el instanceof HTMLSelectElement) {
                el.value = String(args.value);
            }
            return undefined;
        }
        if (action === "nav") {
            if (el instanceof HTMLAnchorElement) {
                const href = el.getAttribute("href") || el.href;
                if (href && href !== "#" && !href.startsWith("javascript:")) {
                    // Dispatch a proper click event so the browser's default
                    // navigation handler kicks in, preserving session history.
                    const ev = new MouseEvent("click", {
                        bubbles: true,
                        cancelable: true,
                        button: 0,
                    });
                    el.dispatchEvent(ev);
                    // If the event was cancelled or the browser didn't
                    // navigate (e.g. content-script restrictions), fall
                    // back to direct location assignment.
                    if (ev.defaultPrevented) {
                        window.location.href = href;
                    }
                }
                return href;
            }
            /** @type {{ click?: () => void }} */
            const clickable = /** @type {any} */ (el);
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
            return { ok: true, result: result };
        } catch (e) {
            return {
                ok: false,
                error: e instanceof Error ? e.message : String(e),
            };
        }
    }

    // ── API ────────────────────────────────────────────────────────

    /**
     * @param {string} attr
     * @param {{ kind: AxFnKind }} def
     */
    function definePrimitive(attr, def) {
        if (!attr.startsWith("ax-")) {
            throw new Error('Primitive "' + attr + '" must start with "ax-"');
        }
        if (PRIMITIVE_KINDS.has(attr)) {
            throw new Error('Primitive "' + attr + '" already exists');
        }
        PRIMITIVE_KINDS.set(attr, def.kind);
    }

    /**
     * @param {string} name
     * @param {AxExtension} extension
     */
    function defineExtension(name, extension) {
        const api = {
            definePrimitive: definePrimitive,
            getScan: function () {
                return lastScan;
            },
        };
        if (extension.init) extension.init(api);
        extensions.set(name, extension);
    }

    /**
     * @param {string} name
     */
    function removeExtension(name) {
        extensions.delete(name);
    }

    /**
     * Check whether an element (or any descendant) has an ax-* or data-ax-* attribute.
     * Walks the subtree up to a configurable depth to find ax annotations.
     * @param {Node} node
     * @returns {boolean}
     */
    function subtreeHasAX(node) {
        if (node.nodeType !== 1) return false;
        const el = /** @type {Element} */ (node);
        // Check the element itself
        const names = el.getAttributeNames();
        let i = 0;
        const len = names.length;
        for (; i < len; i++) {
            const name = names[i];
            if (name.startsWith("ax-") || name.startsWith("data-ax-"))
                return true;
        }
        // Walk direct children (one level deep — enough for most SPA patterns)
        // In practice, ax annotations are in the direct child markup, not deep buried.
        const kids = el.children;
        let ci = 0;
        const clen = kids.length;
        for (; ci < clen; ci++) {
            const child = kids[ci];
            const cnames = child.getAttributeNames();
            let cni = 0;
            const cnlen = cnames.length;
            for (; cni < cnlen; cni++) {
                if (
                    cnames[cni].startsWith("ax-") ||
                    cnames[cni].startsWith("data-ax-")
                )
                    return true;
            }
        }
        return false;
    }

    /**
     * Check whether a mutation record is relevant to ax.
     * Returns true only when actual ax-annotated elements are involved.
     * For childList: checks added/removed nodes for ax attributes.
     * For attributes: checks if the changed attribute is ax-related.
     * @param {MutationRecord} m
     * @returns {boolean}
     */
    function isAXMutation(m) {
        if (m.type === "childList") {
            // Check added nodes
            let ai = 0;
            const alen = m.addedNodes.length;
            for (; ai < alen; ai++) {
                if (subtreeHasAX(m.addedNodes[ai])) return true;
            }
            // Check removed nodes (walk one level deep for containers with ax children)
            let ri = 0;
            const rlen = m.removedNodes.length;
            for (; ri < rlen; ri++) {
                if (subtreeHasAX(m.removedNodes[ri])) return true;
            }
            return false;
        }
        const name = m.attributeName;
        if (!name) return false;
        return name.startsWith("ax-") || name.startsWith("data-ax-");
    }

    /**
     * Start watching the DOM for mutations that affect ax elements.
     * Invalidates the scan cache so the next invoke or scan is fresh.
     * The harness can optionally provide a callback to be notified.
     *
     * No hardcoded attributeFilter — filters in the callback so custom
     * primitives from definePrimitive() and data-ax-* prefixes work
     * automatically.
     * @param {((mutations: MutationRecord[]) => void) | undefined} [callback]
     * @returns {MutationObserver}
     */
    function watch(callback) {
        if (domWatcher) domWatcher.disconnect();
        domWatcher = new MutationObserver(function (mutations) {
            let relevant = false;
            let mi = 0;
            const mlen = mutations.length;
            for (; mi < mlen; mi++) {
                if (isAXMutation(mutations[mi])) {
                    relevant = true;
                    break;
                }
            }
            if (!relevant) return;
            lastScan = null;
            if (callback) callback(mutations);
        });
        domWatcher.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            // No attributeFilter — we filter in the callback,
            // so custom primitives and data-ax-* are covered.
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

    function getNodeId(el) {
        return elementToId.get(el) || null;
    }

    return {
        scan: scan,
        process: process,
        invoke: invoke,
        getNodeId: getNodeId,
        definePrimitive: definePrimitive,
        defineExtension: defineExtension,
        removeExtension: removeExtension,
        watch: watch,
        unwatch: unwatch,
        config: axConfig,
    };
})();

// ── Export ─────────────────────────────────────────────────────

export default ax;
