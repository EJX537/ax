/**
 * ax-autobindgen
 *
 * Heuristic engine that annotates non-ax pages with data-ax-* attributes
 * so the agent harness can interact with them via ax.scan() / ax.invoke().
 *
 * Configurable via JSON rules. Extensible with custom matchers.
 *
 * Usage:
 *   import axAutobindgen from "./extensions/ax-autobindgen.js";
 *   import ax from "./src/index.js";
 *
 *   // Static config: JSON rules object
 *   axAutobindgen.configure({
 *     rules: [
 *       { select: "form",  as: "ctx",  name: "form" },
 *       { select: "button[type='submit']", as: "click", name: "submit" },
 *     ]
 *   });
 *
 *   // Or load from a JSON file
 *   const resp = await fetch("/rules/twitter.json");
 *   axAutobindgen.configure(await resp.json());
 *
 *   // Annotate the DOM
 *   axAutobindgen.bind(document.body);
 *
 *   // Use ax normally
 *   const scan = ax.scan();
 *   ax.invoke(el, "click");
 */

var axAutobindgen = (function () {
    "use strict";

    /** Shortcut to safely get trimmed visible text content, truncated to 60 chars.
     * Uses innerText which skips <style>, <script>, and hidden elements;
     * falls back to textContent with style/script stripped for SVG/non-rendered contexts. */
    function shortText(el) {
        var t = el.innerText;
        if (t && t.replace(/\s+/g, ' ').trim()) {
            return t.replace(/\s+/g, ' ').trim().slice(0, 60);
        }
        // innerText not available or empty (SVG context), get textContent without style/script
        var clone = el.cloneNode(true);
        var removals = clone.querySelectorAll('style,script');
        for (var ri = removals.length - 1; ri >= 0; ri--) {
            removals[ri].remove();
        }
        return (clone.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    }

    /**
     * Collect non-empty text from all descendant <a> elements,
     * joined by ", ", up to 48 chars. Truncates at last clean
     * separator boundary so you don't get a mid-item cut.
     * Returns undefined if no <a> text found (for || fallback chains).
     */
    function linkList(el) {
        var anchors = el.querySelectorAll("a");
        var parts = [];
        for (var i = 0; i < anchors.length; i++) {
            var t = (anchors[i].textContent || '').replace(/\s+/g, ' ').trim();
            if (t && t.length <= 30) { parts.push(t); }
            var joined = parts.join(', ');
            if (joined.length > 48) {
                parts.pop();
                break;
            }
        }
        var result = parts.join(', ');
        return result || undefined;
    }

    /**
     * Log to the debug panel mutation log if available (via window.__axLog),
     * otherwise fall back to console.log.
     * cat: "name" for name-resolution entries, "bind" for lifecycle.
     */
    function axLog(cat, msg) {
        var fn = typeof window !== "undefined" && window.__axLog;
        if (fn) { fn(cat, msg); }
        else if (cat === "bind") { console.log("[ax-autobindgen]", msg); }
    }

    // ── Element AST name extraction ──────────────────────
    //
    // Instead of evaluating JS expressions, each nameFrom is an array of
    // extraction tokens based on the W3C AccName 1.2 algorithm. Each token
    // is tried in order; the first non-empty result wins.
    // No eval, no new Function, no recursive descent parser.
    //
    // Token formats:
    //   @attrName        → el.getAttribute('attrName')
    //   $propName        → el[propName] as string
    //   $propName:N      → el[propName] as string, sliced to N chars
    //   text             → shortText(el) (innerText with style/script strip fallback)
    //   text:N           → shortText(el).slice(0,N)
    //   innerText        → el.innerText directly (rendered text with br→newline)
    //   innerText:N      → el.innerText.slice(0,N)
    //   links            → linkList(el) — all descendant <a> text joined
    //   label            → el.labels[0] text (for form controls)
    //   legend           → first <legend> descendant text
    //   caption          → first <caption> descendant text
    //   figcaption       → first <figcaption> descendant text
    //   svg-title        → first <title> child of <svg>
    //   >selector        → querySelector(sel).textContent trimmed+sliced(40)
    //   >selector@attr   → querySelector(sel).getAttribute(attr)
    //   >selector@text   → querySelector(sel).textContent trimmed+sliced(40)
    //   ^selector@attr   → closest(sel).getAttribute(attr) — climb up
    //   ?visible         → "1" if el.checkVisibility({checkVisibilityCSS:true}) else undefined
    //   ?interactive     → "1" if el is interactive (button,a[href],input,select,textarea,[tabindex],[role=button],[contenteditable])
    //   ?disabled        → "1" if el.disabled or [aria-disabled=true]
    //   ?checked         → "1" if el.checked or [aria-checked=true]
    //   any other string → returned as literal fallback

    /**
     * Apply a post-processing transform to a string value.
     * Supported: |trim, |lower, |upper, |truncate:N, |slug
     */
    function applyTransform(val, transform) {
        if (!val || typeof val !== "string") return val;
        if (transform === 'trim') return val.trim();
        if (transform === 'lower') return val.toLowerCase();
        if (transform === 'upper') return val.toUpperCase();
        if (transform.slice(0, 9) === 'truncate:') {
            var n = parseInt(transform.slice(9), 10);
            if (!isNaN(n)) return val.trim().slice(0, n);
        }
        if (transform === 'slug') {
            return val.replace(/[\/\-_]+/g, ' ').trim() || undefined;
        }
        return val;
    }

    /**
     * Get text from a child element via querySelector, trimmed and sliced to 40.
     */
    function childText(el, sel) {
        if (!el.querySelector) return undefined;
        var child = el.querySelector(sel);
        if (!child) return undefined;
        return (child.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40) || undefined;
    }

    /**
     * Extract a single value from an element using a token string.
     */
    function extractOne(el, token) {
        if (typeof token !== "string" || !token) return undefined;

        var raw = token;
        var transform = null;
        // Check for |transform suffix
        var pipeIdx = token.indexOf('|');
        if (pipeIdx > 0) {
            raw = token.slice(0, pipeIdx);
            transform = token.slice(pipeIdx + 1);
            if (!transform) transform = null;
        }

        var result = extractRaw(el, raw);
        if (result && typeof result === "string") {
            if (transform) result = applyTransform(result, transform);
            return result || undefined;
        }
        return result;
    }

    function extractRaw(el, token) {
        // @attrName → attribute
        if (token.charCodeAt(0) === 64) { // '@'
            if (!el.getAttribute) return undefined;
            return el.getAttribute(token.slice(1)) || undefined;
        }

        // $propName[:N] → property
        if (token.charCodeAt(0) === 36) { // '$'
            var prop = token.slice(1);
            var truncate = null;
            var colonIdx = prop.indexOf(':');
            if (colonIdx > 0) {
                truncate = parseInt(prop.slice(colonIdx + 1), 10);
                prop = prop.slice(0, colonIdx);
            }
            var v;
            if (prop === 'pathname' && el.pathname) {
                v = el.pathname.replace(/[\/\-_]/g, ' ').trim();
            } else if (prop === 'hostname' && el.hostname) {
                v = el.hostname;
            } else if (prop === 'innerText') {
                v = el.innerText || '';
            } else if (prop === 'textContent') {
                v = el.textContent || '';
            } else if (el[prop] !== undefined && el[prop] !== null) {
                v = el[prop];
                if (typeof v !== 'string') v = String(v);
            }
            if (v && typeof v === 'string') {
                if (truncate && !isNaN(truncate)) return v.slice(0, truncate) || undefined;
                return v.trim ? v.trim() || undefined : v || undefined;
            }
            return undefined;
        }

        // text[:N] → shortText
        if (token === 'text') {
            var t = shortText(el);
            return t || undefined;
        }
        if (token.slice(0, 5) === 'text:') {
            var n = parseInt(token.slice(5), 10);
            if (isNaN(n)) return undefined;
            var t = shortText(el);
            return t ? t.slice(0, n) : undefined;
        }

        // innerText[:N] → el.innerText
        if (token === 'innerText') {
            return (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60) || undefined;
        }
        if (token.slice(0, 10) === 'innerText:') {
            var n2 = parseInt(token.slice(10), 10);
            if (isNaN(n2)) return undefined;
            return (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, n2) || undefined;
        }

        // links → linkList
        if (token === 'links') {
            return linkList(el) || undefined;
        }

        // Structural relationship tokens
        if (token === 'label') {
            if (el.labels && el.labels.length) {
                return shortText(el.labels[0]) || undefined;
            }
            return undefined;
        }
        if (token === 'legend') { return childText(el, 'legend'); }
        if (token === 'caption') { return childText(el, 'caption'); }
        if (token === 'figcaption') { return childText(el, 'figcaption'); }
        if (token === 'svg-title') {
            // First <title> child of an <svg>
            if (el.querySelector) {
                var svg = el.tagName === 'svg' ? el : el.querySelector('svg');
                if (svg) {
                    for (var ci = 0; ci < svg.children.length; ci++) {
                        if (svg.children[ci].tagName === 'title') {
                            return (svg.children[ci].textContent || '').trim().slice(0, 60) || undefined;
                        }
                    }
                }
            }
            return undefined;
        }

        // >selector[@attr|@text]
        if (token.charCodeAt(0) === 62 && token.charCodeAt(1) !== 62) { // '>' not '>>'
            if (!el.querySelector) return undefined;
            var atSign = token.indexOf('@', 1);
            var sel, what;
            if (atSign > 1) {
                sel = token.slice(1, atSign);
                what = token.slice(atSign + 1);
            } else {
                sel = token.slice(1);
                what = 'text';
            }
            var child = el.querySelector(sel);
            if (!child) return undefined;
            if (what === 'text' || what === 'textContent') {
                return (child.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40) || undefined;
            }
            if (what === 'innerText') {
                return (child.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40) || undefined;
            }
            // attribute
            return child.getAttribute ? (child.getAttribute(what) || undefined) : undefined;
        }

        // ^selector[@attr|@text] — climb ancestors via closest()
        if (token.charCodeAt(0) === 94) { // '^'
            if (!el.closest) return undefined;
            var atSign2 = token.indexOf('@', 1);
            var sel2, what2;
            if (atSign2 > 1) {
                sel2 = token.slice(1, atSign2);
                what2 = token.slice(atSign2 + 1);
            } else {
                sel2 = token.slice(1);
                what2 = 'text';
            }
            var parent = el.closest(sel2);
            if (!parent || parent === el) return undefined;
            if (what2 === 'text' || what2 === 'textContent') {
                return (parent.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40) || undefined;
            }
            if (what2 === 'innerText') {
                return (parent.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40) || undefined;
            }
            return parent.getAttribute ? (parent.getAttribute(what2) || undefined) : undefined;
        }

        // ?boolean queries
        if (token.charCodeAt(0) === 63) { // '?'
            var query = token.slice(1);
            if (query === 'visible') {
                if (typeof el.checkVisibility === 'function') {
                    return el.checkVisibility({ checkVisibilityCSS: true }) ? '1' : undefined;
                }
                return undefined;
            }
            if (query === 'interactive') {
                if (el.matches) {
                    return el.matches('button,a[href],input,select,textarea,[tabindex],[role=button],[role=link],[role=option],[role=tab],[contenteditable]') ? '1' : undefined;
                }
                return undefined;
            }
            if (query === 'disabled') {
                if (el.disabled || (el.getAttribute && el.getAttribute('aria-disabled') === 'true')) return '1';
                return undefined;
            }
            if (query === 'checked') {
                if (el.checked || (el.getAttribute && el.getAttribute('aria-checked') === 'true')) return '1';
                return undefined;
            }
            if (query === 'selected') {
                if (el.selected || (el.getAttribute && el.getAttribute('aria-selected') === 'true')) return '1';
                return undefined;
            }
            if (query === 'has-children') {
                return el.children && el.children.length > 0 ? '1' : undefined;
            }
            if (query === 'hidden') {
                if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return '1';
                if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ checkVisibilityCSS: true })) return '1';
                return undefined;
            }
            return undefined;
        }

        // Literal fallback
        return token;
    }

    /**
     * Try each extraction token in order, returning the first non-empty
     * string result. Returns empty string if nothing matches.
     */
    function extractName(el, sources) {
        if (!sources || !sources.length) return "";
        for (var i = 0; i < sources.length; i++) {
            var src = sources[i];
            var val = extractOne(el, src);
            if (val && typeof val === "string" && val.trim()) {
                return val.trim();
            }
        }
        return "";
    }

    // ── Internal state ───────────────────────────────────────────

    /** Registered rules (user-configured + builtins) */
    var rules = [];

    /** Custom matchers registered via addMatcher() */
    var matchers = {};

    /** Order of annotation application */
    var annotationOrder = [];

    /** Set of annotated elements (WeakMap) */
    var annotated;

    /** Prefix to use for generated attributes */
    var prefix = "ax";

    /** Track whether builtins are enabled */
    var useBuiltins = true;

    // ── Name resolution ─────────────────────────────────────────

    /**
     * Resolve a rule's name from the element.
     * Supports static string, or a JS expression in nameFrom
     * (e.g. "el.textContent", "el.id || el.name || 'unnamed'").
     */
    function resolveName(el, rule) {
        if (rule.name) return rule.name;
        if (!rule.nameFrom) return "";
        if (typeof rule.nameFrom === "string") {
            // Legacy string nameFrom — treat as a single token
            var v = extractOne(el, rule.nameFrom);
            if (v && typeof v === "string") return v.trim();
            return "";
        }
        // Array of tokens — try each in order
        return extractName(el, rule.nameFrom);
    }

    // ── Matcher registry ────────────────────────────────────────

    /**
     * Register a custom matcher function.
     * Matchers are named so rules can reference them via `match:`
     * instead of a CSS selector.
     *
     *   axAutobindgen.addMatcher("testid", function(el, rule) {
     *     return el.getAttribute("data-testid") === rule.value;
     *   });
     *   // Then in config: { match: "testid", value: "tweet", as: "ctx", name: "tweet" }
     */
    function addMatcher(name, fn) {
        matchers[name] = fn;
    }

    // ── Rule configuration ──────────────────────────────────────

    /**
     * Configure autobindgen with rules.
     *
     * @param {Object} config
     * @param {Array}  [config.rules]      - Array of rule objects
     * @param {boolean} [config.builtins]  - Enable built-in heuristics (default: true)
     * @param {string}  [config.prefix]    - Attribute prefix (default: "data-ax")
     */
    function configure(config) {
        rules = [];
        if (config.prefix) prefix = config.prefix;
        useBuiltins = config.builtins !== false;

        if (config.rules && config.rules.length) {
            for (var i = 0; i < config.rules.length; i++) {
                addRule(config.rules[i]);
            }
        }
    }

    /**
     * Add a single rule.
     * A rule has:
     *   { select, as, name?, nameFrom?, match?, value? }
     *
     * - `select`: CSS selector (used when no custom matcher is specified)
     * - `match`: custom matcher name registered via addMatcher()
     * - `value`: value passed to the custom matcher
     * - `as`: primitive type ("ctx", "click", "edit", "view", "nav", "ignore")
     * - `name`: static name string
     * - `nameFrom`: JS expression to derive name from el
     */
    function addRule(rule) {
        rules.push(rule);
    }

    // ── Core: match element against rules ───────────────────────

    /**
     * Test an element against all registered rules (user rules first, then builtins).
     * Returns the first matching rule, or null.
     */
    function matchElement(el) {
        for (var i = 0; i < rules.length; i++) {
            if (testRule(el, rules[i])) return rules[i];
        }
        if (useBuiltins) {
            for (var j = 0; j < BUILTIN_RULES.length; j++) {
                if (testRule(el, BUILTIN_RULES[j])) return BUILTIN_RULES[j];
            }
        }
        return null;
    }

    /**
     * Test a single rule against an element.
     */
    function testRule(el, rule) {
        if (rule.match) {
            var fn = matchers[rule.match];
            if (fn) return fn(el, rule);
            return false;
        }
        if (rule.select) {
            try {
                return el.matches(rule.select);
            } catch {
                return false;
            }
        }
        return false;
    }

    // ── Built-in heuristic rules ────────────────────────────────
    // These fire when no explicit rule catches an element first.
    // Name resolution uses safeEval() which does NOT use new Function
    // (new Function is blocked by page CSP).

    var BUILTIN_RULES = [
        // ── IGNORE: non-content, structural, hidden ─────────────────
        { select: "script", as: "ignore" },
        { select: "style", as: "ignore" },
        { select: "meta", as: "ignore" },
        { select: "link", as: "ignore" },
        { select: "noscript", as: "ignore" },
        { select: "br", as: "ignore" },
        { select: "hr", as: "ignore" },
        { select: "head", as: "ignore" },
        { select: "[aria-hidden='true']", as: "ignore" },

        // ── EDIT: form controls (auto-adds +click for focus) ─────
        { select: "textarea", as: "edit", nameFrom: ["@aria-label", "label", "@placeholder", "@title", "textarea"] },
        { select: "input:not([type='hidden']):not([type='submit']):not([type='button']):not([type='reset']):not([type='image']):not([type='checkbox']):not([type='radio']):not([type='file'])", as: "edit", nameFrom: ["@aria-label", "label", "@placeholder", "@title", "input"] },
        { select: "input[type='checkbox']", as: "edit", nameFrom: ["@aria-label", "^label@text", "text", "checkbox"] },
        { select: "input[type='radio']", as: "edit", nameFrom: ["@aria-label", "^label@text", "text", "radio"] },
        { select: "input[type='file']", as: "edit", nameFrom: ["@aria-label", "@title", "file-upload"] },
        { select: "select", as: "edit", nameFrom: ["@aria-label", "label", "$innerText|truncate:40", "select"] },
        { select: "[contenteditable]", as: "edit", nameFrom: ["@aria-label", "@title", "text", "$innerText|truncate:40", "editable"] },
        { select: "[role='textbox'],[role='searchbox']", as: "edit", nameFrom: ["@aria-label", "label", "@placeholder", "@title", "input"] },
        { select: "[role='combobox']", as: "edit", nameFrom: ["@aria-label", "label", "@placeholder", "@title", "$innerText|truncate:40", "combo"] },
        { select: "[role='spinbutton']", as: "edit", nameFrom: ["@aria-label", "@aria-valuenow", "@title", "spinbutton"] },
        { select: "[role='slider']", as: "edit", nameFrom: ["@aria-label", "@aria-valuetext", "@aria-valuenow", "slider"] },

        // ── CLICK: interactive actions (in-page state changes) ───
        // Explicit ARIA interactive roles (native form controls already matched above)
        { select: "[role='button']", as: "click", nameFrom: ["@aria-label", "@title", "text", "$innerText", "button"] },
        { select: "[role='tab']", as: "click", nameFrom: ["@aria-label", "text", "$innerText", "tab"] },
        { select: "[role='menuitem']", as: "click", nameFrom: ["@aria-label", "text", "$innerText", "menu-item"] },
        { select: "[role='menuitemcheckbox'],[role='menuitemradio']", as: "click", nameFrom: ["@aria-label", "text", "$innerText", "menu-item"] },
        { select: "[role='switch']", as: "click", nameFrom: ["@aria-label", "text", "switch"] },
        { select: "[role='checkbox']", as: "click", nameFrom: ["@aria-label", "text", "checkbox"] },
        { select: "[role='radio']", as: "click", nameFrom: ["@aria-label", "text", "radio"] },
        { select: "[role='option']", as: "click", nameFrom: ["@aria-label", "text", "option"] },
        { select: "[role='treeitem']", as: "click", nameFrom: ["@aria-label", "text", "tree-item"] },

        // Native buttons
        { select: "button", as: "click", nameFrom: ["@aria-label", "@title", "text", "$innerText|truncate:40", "button"] },
        { select: "input[type='submit']", as: "click", nameFrom: ["@value", "@aria-label", "text", "submit"] },
        { select: "input[type='button']", as: "click", nameFrom: ["@value", "@aria-label", "text", "button"] },
        { select: "input[type='reset']", as: "click", nameFrom: ["@value", "@aria-label", "text", "reset"] },
        { select: "input[type='image']", as: "click", nameFrom: ["@alt", "@aria-label", "@title", "image-button"] },

        // JavaScript anchors = buttons (definitely not nav)
        { select: "a[href^='javascript:']", as: "click", nameFrom: ["@aria-label", "@title", "text", "$innerText|truncate:40", "button"] },

        // Page-internal hash anchors = buttons (no real navigation)
        { select: "a[href='#'],a[href^='#']", as: "click", nameFrom: ["@aria-label", "@title", "text", "$innerText|truncate:40", "button"] },

        // Inline event handlers
        { select: "[onclick]", as: "click", nameFrom: ["@aria-label", "@title", "text", "$innerText|truncate:40", "clickable"] },
        { select: "[ondblclick],[onmousedown],[onpointerdown]", as: "click", nameFrom: ["@aria-label", "@title", "text", "$innerText|truncate:40", "clickable"] },

        // Framework data attributes (generic click trigger patterns)
        { select: "[data-action]", as: "click", nameFrom: ["@aria-label", "text", "$innerText|truncate:40", "action"] },
        { select: "[data-toggle]", as: "click", nameFrom: ["@aria-label", "@data-toggle", "text", "toggle"] },
        { select: "[data-behavior]", as: "click", nameFrom: ["@aria-label", "@data-behavior", "text", "behavior"] },
        { select: "[data-target]", as: "click", nameFrom: ["@aria-label", "text", "$innerText|truncate:40", "target"] },
        { select: "[data-modal]", as: "click", nameFrom: ["@aria-label", "text", "$innerText|truncate:40", "modal"] },

        // Disclosure widgets (details/summary, aria-expanded)
        { select: "details > summary", as: "click", nameFrom: ["text", "$innerText|truncate:40", "expand"] },
        { select: "[aria-expanded]", as: "click", nameFrom: ["@aria-label", "@title", "text", "$innerText|truncate:40", "toggle"] },
        { select: "[aria-haspopup]", as: "click", nameFrom: ["@aria-label", "text", "$innerText|truncate:40", "dropdown"] },

        // role=link is interactive click (may or may not navigate)
        { select: "[role='link']", as: "click", nameFrom: ["@aria-label", "@title", "text", "$innerText|truncate:40", "link"] },

        // ── NAV: guaranteed URL navigation ────────────────────────
        // External absolute URLs
        { select: "a[href^='http://'],a[href^='https://']", as: "nav", nameFrom: ["@aria-label", "@title", "text", "$innerText|truncate:40", "$pathname", "link"] },
        // Relative paths
        { select: "a[href^='/']", as: "nav", nameFrom: ["@aria-label", "@title", "text", "$innerText|truncate:40", "$pathname", "link"] },
        // Other real hrefs (not #, javascript:, or empty)
        { select: "a[href]:not([href='#']):not([href^='#']):not([href^='javascript:']):not([href=''])", as: "nav", nameFrom: ["@aria-label", "@title", "text", "$innerText|truncate:40", "$pathname", "link"] },
        // Image map areas
        { select: "area[href]", as: "nav", nameFrom: ["@alt", "@aria-label", "@title", "link"] },

        // ── CTX: scope boundaries (containers with semantic meaning) ─
        { select: "nav,[role='navigation']", as: "ctx", nameFrom: ["@aria-label", "links", "nav", "navigation"] },
        { select: "main,[role='main']", as: "ctx", name: "main" },
        { select: "section", as: "ctx", nameFrom: ["@aria-label", "@aria-labelledby", "^label@text", ">h1@text", ">h2@text", "section"] },
        { select: "article", as: "ctx", nameFrom: ["@aria-label", "@aria-labelledby", ">h1@text", ">h2@text", "article"] },
        { select: "aside,[role='complementary']", as: "ctx", nameFrom: ["@aria-label", "@title", "sidebar"] },
        { select: "form", as: "ctx", nameFrom: ["@aria-label", "@title", "^label@text", "form"] },
        { select: "fieldset", as: "ctx", nameFrom: ["legend", "@aria-label", "@title", "fieldset"] },
        { select: "[role='dialog'],[role='alertdialog'],dialog", as: "ctx", nameFrom: ["@aria-label", "@aria-labelledby", "dialog"] },
        { select: "[role='tablist']", as: "ctx", nameFrom: ["@aria-label", "tabs"] },
        { select: "[role='menu'],[role='menubar']", as: "ctx", nameFrom: ["@aria-label", "menu"] },
        { select: "[role='toolbar']", as: "ctx", nameFrom: ["@aria-label", "toolbar"] },
        { select: "[role='tree']", as: "ctx", nameFrom: ["@aria-label", "tree"] },
        { select: "[role='grid'],[role='table'],table", as: "ctx", nameFrom: ["@aria-label", "caption", "grid"] },
        { select: "[role='region'],[role='group']", as: "ctx", nameFrom: ["@aria-label", "@aria-labelledby", "region"] },
        { select: "ol,ul", as: "ctx", nameFrom: ["@aria-label", "@title", "list"] },
        { select: "header", as: "ctx", nameFrom: ["@aria-label", "links", "header"] },
        { select: "footer", as: "ctx", nameFrom: ["@aria-label", "links", "footer"] },

        // ── VIEW: read-only content display ──────────────────────
        { select: "img[alt]", as: "view", nameFrom: ["@alt", "@aria-label", "@title", "image"] },
        { select: "h1", as: "view", nameFrom: ["text", "$innerText|truncate:40", "heading"] },
        { select: "h2,h3,h4,h5,h6,[role='heading']", as: "view", nameFrom: ["text", "$innerText|truncate:40", "heading"] },
        { select: "label", as: "view", nameFrom: ["text", "label"] },
        { select: "p", as: "view", nameFrom: ["text", "$innerText|truncate:40", "paragraph"] },
        { select: "li", as: "view", nameFrom: ["text", "$innerText|truncate:40", "item"] },
        { select: "td,th", as: "view", nameFrom: ["text", "$innerText|truncate:40", "cell"] },
        { select: "figcaption", as: "view", nameFrom: ["text", "caption"] },
        { select: "[data-value]", as: "view", nameFrom: ["text", "$innerText|truncate:40", "select"] },
        { select: "[role='status'],[role='log'],[role='timer']", as: "view", nameFrom: ["@aria-label", "text", "status"] },
        { select: "[role='img'],[role='figure']", as: "view", nameFrom: ["@aria-label", "@title", "image"] },
    ];

    // ── DOM annotation ──────────────────────────────────────────

    /**
     * Walk the DOM tree starting from root and annotate matching elements.
     */
    function bind(root) {
        root = root || document.documentElement;

        // No rules configured — skip all annotation work entirely
        if ((!rules || rules.length === 0) && (!useBuiltins || !BUILTIN_RULES || BUILTIN_RULES.length === 0)) {
            return;
        }

        annotationOrder = [];
        annotated = new WeakMap();
        // Tags that are never useful to annotate — skip immediately
        var SKIP_TAGS = { br:1, hr:1, wbr:1, template:1, slot:1, base:1, link:1, meta:1, source:1, track:1, param:1, area:1, col:1, colgroup:1 };
        // Remove all previous bindgen annotations
        var prev = root.querySelectorAll("[" + prefix + "-ctx],[" + prefix + "-click],[" + prefix + "-nav],[" + prefix + "-edit],[" + prefix + "-view],[" + prefix + "-ignore],[" + prefix + "-bindgen]");
        for (var pi = 0; pi < prev.length; pi++) {
            var pel = prev[pi];
            pel.removeAttribute(prefix + "-ctx");
            pel.removeAttribute(prefix + "-click");
            pel.removeAttribute(prefix + "-nav");
            pel.removeAttribute(prefix + "-edit");
            pel.removeAttribute(prefix + "-view");
            pel.removeAttribute(prefix + "-ignore");
            pel.removeAttribute(prefix + "-bindgen");
        }
        // Pre-compute rule matches once using per-rule querySelectorAll
        var elRuleMap = precomputeMatches(root);

        var all = root.querySelectorAll("*");
        for (var i = 0; i < all.length; i++) {
            var el = all[i];
            if (SKIP_TAGS[el.tagName.toLowerCase()]) continue;
            if (hasNativeAX(el)) continue;
            if (annotated.has(el)) continue;
            // Mark hidden/invisible elements with ax-ignore.
            // Uses only reliable CSS-computed visibility checks.
            // <select> elements are exempt — they are inherently interactive
            // even when visually hidden (e.g., Amazon overlays them with
            // opacity:0 over a visual facade). The facade div gets a view
            // annotation for display; the <select> gets edit+click for action.
            if (el.nodeType === 1 && el.tagName !== 'SELECT') {
                var hc = false;
                if (typeof el.checkVisibility === "function" && !el.checkVisibility({ checkVisibilityCSS: true })) {
                    hc = true;
                } else if (window.getComputedStyle(el).opacity === "0") {
                    hc = true;
                } else {
                    var bbox = el.getBoundingClientRect();
                    if (bbox.bottom < 0 || bbox.right < 0 || bbox.top > window.innerHeight || bbox.left > window.innerWidth) {
                        hc = true;
                    }
                }
                if (hc) {
                    el.setAttribute(prefix + "-ignore", "hidden");
                    // Don't continue — still annotate hidden elements
                    // so the tree has their full type/name info even
                    // when the consumer toggles hidden visibility off.
                }
            }
            // O(1) lookup from precomputed map
            var rule = elRuleMap.get(el) || null;
            if (!rule) continue;
            applyAnnotation(el, rule);
            annotated.set(el, true);
            var attr = prefix + "-" + rule.as;
            var value = el.getAttribute(attr) || "";
            annotationOrder.push({ el: el, type: rule.as, value: value });
        }
        deduplicateNames(root);
    }

    /**
     * Check if element has native ax-* or data-ax-* attributes.
     */
    function hasNativeAX(el) {
        var known = [prefix + "-ctx", prefix + "-click", prefix + "-nav", prefix + "-edit", prefix + "-view", prefix + "-ignore", prefix + "-bindgen"];
        for (var i = 0; i < el.attributes.length; i++) {
            var name = el.attributes[i].name;
            if (name.startsWith("ax-") || name.startsWith("data-ax-")) {
                if (known.indexOf(name) === -1) return true;
            }
        }
        return false;
    }

    /**
     * Apply a rule's annotation to an element.
     */
    function applyAnnotation(el, rule) {
        if (rule.as === "ignore") {
            el.setAttribute(prefix + "-ignore", "always");
            return;
        }

        var attr = prefix + "-" + rule.as;
        var name = resolveName(el, rule);
        var finalValue;

        if (rule.as === "ctx") {
            finalValue = name || el.id || el.tagName.toLowerCase();
            el.setAttribute(attr, finalValue);
        } else {
            var fallback = el.tagName.toLowerCase();
            if (el.id) fallback += '#' + el.id;
            finalValue = name || fallback;
            el.setAttribute(attr, finalValue);
        }

        var text40 = (el.textContent||"").replace(/\s+/g," ").trim().slice(0,40);
        var tagId = el.tagName.toLowerCase() + (el.id ? "#"+el.id : "");
        if (!name) {
            axLog("name", "FALLBACK " + rule.as + " " + rule.select +
                " tag=" + tagId +
                " final=" + JSON.stringify(finalValue) +
                " text=" + JSON.stringify(text40));
        } else {
            axLog("name", rule.as + " \u2192 " + JSON.stringify(finalValue) +
                " on " + tagId +
                " text=" + JSON.stringify(text40));
        }

        el.setAttribute(prefix + "-bindgen", "1");

        // Editable elements also get a click annotation so the agent
        // can focus them before typing. Uses the same resolved name.
        if (rule.as === "edit") {
            var clickAttr = prefix + "-click";
            if (!el.hasAttribute(clickAttr)) {
                el.setAttribute(clickAttr, finalValue || "focus");
                axLog("name", "+click on " + tagId + " via=" + JSON.stringify(finalValue));
            }
        }
    }

    /**
     * Find the nearest ancestor (or self) that has a data-ax-* annotation.
     */
    function nearestAnnotatedParent(el) {
        while (el) {
            for (var i = 0; i < el.attributes.length; i++) {
                var name = el.attributes[i].name;
                if (name.indexOf(prefix) === 0) return el;
            }
            el = el.parentElement;
        }
        return null;
    }

    /**
     * Deduplicate annotation names within the same direct container.
     */
    function deduplicateNames(root) {
        var groupMap = new Map();
        for (var i = 0; i < annotationOrder.length; i++) {
            var item = annotationOrder[i];
            if (item.type === 'ctx') continue;
            var parent = nearestAnnotatedParent(item.el.parentElement) || root;
            if (!groupMap.has(parent)) groupMap.set(parent, Object.create(null));
            var byType = groupMap.get(parent);
            if (!byType[item.type]) byType[item.type] = Object.create(null);
            if (!byType[item.type][item.value]) byType[item.type][item.value] = [];
            byType[item.type][item.value].push(item.el);
        }

        groupMap.forEach(function(byType) {
            var typeKeys = Object.keys(byType);
            for (var t = 0; t < typeKeys.length; t++) {
                var byValue = byType[typeKeys[t]];
                var valueKeys = Object.keys(byValue);
                for (var v = 0; v < valueKeys.length; v++) {
                    var els = byValue[valueKeys[v]];
                    if (els.length > 1) {
                        var attr = prefix + "-" + typeKeys[t];
                        for (var e = 0; e < els.length; e++) {
                            var suffix = e === 0 ? "" : "_" + (e + 1);
                            els[e].setAttribute(attr, valueKeys[v] + suffix);
                        }
                    }
                }
            }
        });
    }

    // ── Pre-compute rule matches ─────────────────────────────

    /**
     * Pre-compute rule matches for all CSS-selector-based rules at once.
     * Uses querySelectorAll per rule (O(R) queries instead of O(N*R) el.matches calls).
     * Rules with .match (custom matchers) are NOT included — they must be handled
     * element-by-element.
     *
     * Preserves first-match-wins ordering: user rules first, then builtins.
     *
     * @param {Element} root - DOM root to scan within
     * @returns {Map<Element, object>} Map from element to matching rule
     */
    function precomputeMatches(root) {
        /** @type {Map<Element, object>} */
        var map = new Map();

        // Process all rules (user + builtins) in order, first-match-wins
        var allRules = rules.concat(useBuiltins ? BUILTIN_RULES : []);
        for (var ri = 0; ri < allRules.length; ri++) {
            var rule = allRules[ri];
            if (!rule.select) continue; // skip match-type rules
            try {
                var matched = root.querySelectorAll(rule.select);
                for (var mi = 0; mi < matched.length; mi++) {
                    var el = matched[mi];
                    if (!map.has(el)) {
                        map.set(el, rule);
                    }
                }
            } catch (e) {
                // Some selectors may throw on invalid pages
                axLog("bind", "querySelectorAll error for '" + rule.select + "': " + e);
            }
        }

        return map;
    }

    /**
     * Remove all annotations applied by bindgen.
     */
    function unbind(root) {
        root = root || document.documentElement;
        var all = root.querySelectorAll("*");
        for (var i = 0; i < all.length; i++) {
            var el = all[i];
            if (annotated.has(el)) {
                for (var j = el.attributes.length - 1; j >= 0; j--) {
                    var name = el.attributes[j].name;
                    if (name.startsWith(prefix + "-")) {
                        el.removeAttribute(name);
                    }
                }
                annotated.delete(el);
            }
        }
    }

    // ── Public API ──────────────────────────────────────────────

    return {
        configure: configure,
        addRule: addRule,
        addMatcher: addMatcher,
        bind: bind,
        unbind: unbind,
        BUILTIN_RULES: BUILTIN_RULES,
    };
})();

export default axAutobindgen;
