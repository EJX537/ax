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

    /** Shortcut to safely get trimmed text content, truncated to 60 chars. */
    function shortText(el) {
        return (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
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

    // ── Safe expression evaluator (no new Function/eval) ──────

    /**
     * Evaluate a nameFrom expression against an element without using
     * new Function or eval (both blocked by page CSP).
     *
     * Supports the patterns used in BUILTIN_RULES:
     *   - || chains, &&, ternary ( ? : )
     *   - shortText(el), el.getAttribute('x'), el.querySelector('x')
     *   - el.id, el.name, el.pathname, el.hostname, el.type, el.href, el.alt, el.value, el.placeholder, el.textContent, el.innerText, el.tagName, el.labels, el.checked
     *   - .trim(), .slice(N,M), .replace(/.../g,'...'), .toLowerCase()
     *   - string literals in single quotes
     *   - optional chaining (?.) — just treats as regular access
     *   - (expr) grouping
     */
    function safeEval(el, expr) {
        if (typeof expr !== "string") return "";
        expr = expr.trim();
        if (!expr) return "";

        var pos = 0;
        var ch = function () { return expr[pos]; };
        var advance = function () { pos++; };

        /** Skip whitespace */
        function skipWS() {
            while (pos < expr.length && (expr[pos] === ' ' || expr[pos] === '\t' || expr[pos] === '\n')) advance();
        }

        /** Parse a string literal (single-quoted) */
        function parseString() {
            if (ch() !== "'") return undefined;
            advance(); // skip opening '
            var s = "";
            while (pos < expr.length && ch() !== "'") {
                if (ch() === "\\") { advance(); if (pos < expr.length) s += ch(); }
                else { s += ch(); }
                advance();
            }
            if (pos < expr.length) advance(); // skip closing '
            return s;
        }

        /** Parse a negative number (like -1) */
        function parseNumber() {
            var s = "";
            if (ch() === '-') { s += '-'; advance(); }
            while (pos < expr.length && expr[pos] >= '0' && expr[pos] <= '9') {
                s += ch(); advance();
            }
            if (s === '-' || s === "") return undefined;
            return parseInt(s, 10);
        }

        /** Get a property value from obj by name */
        function getProp(obj, name) {
            if (obj == null) return undefined;
            if (name === "trim") return function () { return String(obj).trim(); };
            if (name === "slice") return function (a, b) { return String(obj).slice(a, b); };
            if (name === "toLowerCase") return function () { return String(obj).toLowerCase(); };
            if (name === "length") return obj.length;
            return obj[name];
        }

        /**
         * Consume a chain of .method(args) or .property accesses on a value.
         * Returns the final value (may be string, number, null).
         */
        function chainCalls(val) {
            while (pos < expr.length) {
                skipWS();
                if (ch() === '.') {
                    advance();
                    skipWS();
                    // Optional chaining ?.
                    if (ch() === '?') { advance(); if (ch() === '.') advance(); }
                    var propName = "";
                    while (pos < expr.length && /[a-zA-Z0-9_]/.test(ch())) {
                        propName += ch(); advance();
                    }
                    if (!propName) break;
                    skipWS();
                    if (ch() === '(') {
                        advance();
                        var args = [];
                        skipWS();
                        if (ch() !== ')') {
                            args.push(parseOrExpr());
                            skipWS();
                            while (ch() === ',') {
                                advance(); skipWS();
                                args.push(parseOrExpr());
                                skipWS();
                            }
                        }
                        if (ch() === ')') advance();
                        if (val == null) return undefined;
                        if (typeof val[propName] === "function") {
                            val = val[propName].apply(val, args);
                        } else {
                            return undefined;
                        }
                    } else {
                        if (val == null) return undefined;
                        val = getProp(val, propName);
                    }
                } else if (ch() === '?') {
                    advance();
                    if (ch() === '.' || ch() === '?') advance();
                    skipWS();
                    // read property name — same as after '.'
                    var propName = "";
                    while (pos < expr.length && /[a-zA-Z0-9_]/.test(ch())) {
                        propName += ch(); advance();
                    }
                    if (!propName) break;
                    skipWS();
                    if (ch() === '(') {
                        advance();
                        var args = [];
                        skipWS();
                        if (ch() !== ')') {
                            args.push(parseOrExpr());
                            skipWS();
                            while (ch() === ',') {
                                advance(); skipWS();
                                args.push(parseOrExpr());
                                skipWS();
                            }
                        }
                        if (ch() === ')') advance();
                        if (val == null) return undefined;
                        if (typeof val[propName] === "function") {
                            val = val[propName].apply(val, args);
                        } else {
                            return undefined;
                        }
                    } else {
                        if (val == null) return undefined;
                        val = getProp(val, propName);
                    }
                } else {
                    break;
                }
            }
            return val;
        }

        /**
         * Parse a simple value or (expr) and then chain method calls.
         */
        function parseValue() {
            skipWS();
            if (pos >= expr.length) return undefined;

            // String literal
            if (ch() === "'") return chainCalls(parseString());

            // Numeric literal
            if (ch() === '-' || (ch() >= '0' && ch() <= '9')) {
                var n = parseNumber();
                if (n !== undefined) return chainCalls(n);
            }

            // (expr)
            if (ch() === '(') {
                advance();
                var inner = parseOrExpr();
                skipWS();
                if (ch() === ')') advance();
                return chainCalls(inner);
            }

            // Identifier
            var path = "";
            while (pos < expr.length && /[a-zA-Z0-9_]/.test(ch())) {
                path += ch(); advance();
            }
            if (!path) return undefined;

            // Function call: shortText(el) or similar
            skipWS();
            if (ch() === '(') {
                advance();
                var argVal = parseOrExpr();
                skipWS();
                if (ch() === ')') advance();
                if (path === "shortText" && typeof argVal !== "undefined") {
                    return chainCalls(shortText(argVal));
                }
                if (path === "linkList" && typeof argVal !== "undefined") {
                    return chainCalls(linkList(argVal));
                }
                return undefined;
            }

            // el.* chain
            if (path === "el") {
                var val = chainCalls(el);
                if (typeof val === "function") return "";
                if (val == null) return "";
                return val;
            }

            // Plain word fallback
            return path;
        }

        /** Parse a ternary * ... : ... */
        function parseConditional() {
            var cond = parseOrExpr();
            if (cond === undefined) return undefined;
            // Once parseOrExpr returns, check if followed by ?
            // We handle this differently: parseOrExpr calls us back
            return cond;
        }

        /** Parse the right side of a ternary */
        function parseTernaryTail() {
            skipWS();
            if (ch() === '?') {
                advance();
                var trueVal = parseOrExpr();
                skipWS();
                var falseVal = undefined;
                if (ch() === ':') {
                    advance();
                    falseVal = parseOrExpr();
                }
                return trueVal !== undefined && trueVal !== null && trueVal !== false && trueVal !== "" ? trueVal : (falseVal !== undefined ? falseVal : "");
            }
            return undefined;
        }

        /**
         * Parse top-level expression with || and && chains.
         * Each operand is parsed, evaluated, and if it's truthy (for ||)
         * returns it immediately.
         */
        function parseOrExpr() {
            var result = parseMaybeTernary();
            while (true) {
                skipWS();
                if (expr.substr(pos, 2) === "||") {
                    pos += 2;
                    var right = parseMaybeTernary();
                    // || returns first truthy value
                    if (result && typeof result === "string" && result.length > 0) return result;
                    if (result !== undefined && result !== null && result !== false && result !== "") return result;
                    result = right;
                } else if (expr.substr(pos, 2) === "&&") {
                    pos += 2;
                    var andRight = parseMaybeTernary();
                    result = (result && andRight !== undefined && andRight !== null && andRight !== false && andRight !== "") ? andRight : "";
                } else {
                    break;
                }
            }
            return result;
        }

        /** Ternary or simple value */
        function parseMaybeTernary() {
            var val = parseValue();
            if (val === undefined) return undefined;
            skipWS();
            if (ch() === '?') {
                advance();
                var truePart = parseOrExpr();
                skipWS();
                var falsePart = undefined;
                if (ch() === ':') {
                    advance();
                    falsePart = parseOrExpr();
                }
                // Evaluate ternary: if val is truthy, return truePart, else falsePart
                var isTruthy = (val !== undefined && val !== null && val !== false && val !== "" && val !== 0);
                return isTruthy ? (truePart !== undefined ? truePart : "") : (falsePart !== undefined ? falsePart : "");
            }
            return val;
        }

        try {
            var result = parseOrExpr();
            if (typeof result === "string") return result;
            if (result !== undefined && result !== null) return String(result);
            return "";
        } catch (e) {
            axLog("name", "safeEval error " + (expr || "").slice(0, 80) + " " + e);
            return "";
        }
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
    var prefix = "data-ax";

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
        var val = safeEval(el, rule.nameFrom);
        if (val && typeof val === "string") {
            var trimmed = val.trim();
            if (!trimmed) {
                axLog("name", "whitespace-only " + rule.as + " " + rule.select + " val=" + JSON.stringify(val));
            }
            return trimmed;
        }
        if (el && el.tagName) {
            var href_ = el.getAttribute ? el.getAttribute("href") : null;
            var text_ = (el.textContent||"").replace(/\s+/g," ").trim().slice(0,40);
            var alabel_ = el.getAttribute ? el.getAttribute("aria-label") : null;
            var title_ = el.getAttribute ? el.getAttribute("title") : null;
            var imgalt_ = el.querySelector ? (function(){var i=el.querySelector("img");return i?i.alt:""})() : "";
            var svgtitle_ = el.querySelector ? (function(){var t=el.querySelector("svg title");return t?t.textContent.trim():""})() : "";
            var pname_ = typeof el.pathname !== "undefined" ? el.pathname : "N/A";
            axLog("name", "EMPTY " + rule.as + " " + rule.select +
                " el=" + el.tagName.toLowerCase() + (el.id ? "#"+el.id : "") +
                " text=" + JSON.stringify(text_) +
                " aria-label=" + JSON.stringify(alabel_) +
                " title=" + JSON.stringify(title_) +
                " img.alt=" + JSON.stringify(imgalt_) +
                " svg.title=" + JSON.stringify(svgtitle_) +
                " href=" + href_ +
                " pathname=" + pname_);
        }
        return "";
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
        // Structural contexts — prefer existing identifiers, fall back to tag type
        { select: "form", as: "ctx", nameFrom: "el.id || el.name || el.getAttribute('aria-label') || el.querySelector('legend')?.textContent?.trim()?.slice(0,30) || 'form'" },
        { select: "nav", as: "ctx", nameFrom: "el.getAttribute('aria-label') || linkList(el) || shortText(el).slice(0,24) || 'nav'" },
        { select: "main", as: "ctx", nameFrom: "el.getAttribute('aria-label') || 'main'" },
        { select: "header", as: "ctx", nameFrom: "el.getAttribute('aria-label') || el.querySelector('h1,h2,h3,h4,h5,h6')?.textContent?.replace(/\\s+/g,' ').trim().slice(0,24) || shortText(el).slice(0,24) || 'header'" },
        { select: "footer", as: "ctx", nameFrom: "el.getAttribute('aria-label') || shortText(el).slice(0,24) || 'footer'" },
        { select: "table", as: "ctx", nameFrom: "el.id || el.getAttribute('aria-label') || el.querySelector('caption')?.textContent?.trim()?.slice(0,30) || 'table'" },
        { select: "article", as: "ctx", nameFrom: "el.id || el.getAttribute('aria-label') || el.querySelector('h1,h2,h3,h4')?.textContent?.replace(/\\s+/g,' ').trim().slice(0,30) || shortText(el).slice(0,30) || 'article'" },
        { select: "section", as: "ctx", nameFrom: "el.id || el.getAttribute('aria-label') || el.querySelector('h1,h2,h3,h4')?.textContent?.replace(/\\s+/g,' ').trim().slice(0,30) || shortText(el).slice(0,30) || 'section'" },
        { select: "[role='dialog']", as: "ctx", nameFrom: "el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || 'dialog'" },
        { select: "[role='main']", as: "ctx", nameFrom: "el.getAttribute('aria-label') || 'main'" },
        { select: "[role='navigation']", as: "ctx", nameFrom: "el.getAttribute('aria-label') || linkList(el) || 'navigation'" },

        // Navigation — all <a> elements
        { select: "a[href]", as: "nav", nameFrom: "shortText(el) || el.getAttribute('aria-label') || el.getAttribute('title') || (el.querySelector('img')?el.querySelector('img').alt:'') || (el.querySelector('svg title')?el.querySelector('svg title').textContent.trim():'') || el.pathname.replace(/[\\/\\-_]/g,' ').trim().slice(0,40) || el.hostname || 'link'" },
        { select: "[role='link']", as: "nav", nameFrom: "shortText(el) || el.getAttribute('aria-label') || el.getAttribute('title') || 'link'" },

        // Clickable elements
        { select: "button", as: "click", nameFrom: "shortText(el) || el.innerText?.trim()?.slice(0,60) || el.getAttribute('aria-label') || el.getAttribute('title') || 'button'" },
        { select: "button[type='submit']", as: "click", nameFrom: "shortText(el) || el.innerText?.trim()?.slice(0,60) || el.getAttribute('aria-label') || 'submit'" },
        { select: "input[type='submit']", as: "click", nameFrom: "(el.value || '').trim().slice(0,40) || 'submit'" },
        { select: "input[type='button']", as: "click", nameFrom: "(el.value || '').trim().slice(0,40) || 'button'" },
        { select: "[role='button']", as: "click", nameFrom: "shortText(el) || el.innerText?.trim()?.slice(0,60) || el.getAttribute('aria-label') || el.getAttribute('title') || 'button'" },
        { select: "[onclick]", as: "click", nameFrom: "shortText(el) || el.innerText?.trim()?.slice(0,60) || 'clickable'" },
        { select: "input[type='checkbox']", as: "click", nameFrom: "el.labels?.length ? shortText(el.labels[0]) : el.value || el.name || 'checkbox'" },
        { select: "input[type='radio']", as: "click", nameFrom: "el.labels?.length ? shortText(el.labels[0]) : el.value || el.name || 'radio'" },

        // Editable inputs
        { select: "input:not([type='hidden']):not([type='submit']):not([type='button']):not([type='checkbox']):not([type='radio'])",
          as: "edit",
          nameFrom: "el.placeholder || el.name || el.id || el.getAttribute('aria-label') || el.type" },
        { select: "textarea", as: "edit", nameFrom: "el.placeholder || el.name || el.id || 'textarea'" },
        { select: "select", as: "edit", nameFrom: "el.name || el.id || el.getAttribute('aria-label') || 'select'" },
        { select: "[contenteditable='true']", as: "edit", nameFrom: "el.id || el.getAttribute('aria-label') || 'editable'" },

        // Viewable text
        { select: "h1", as: "view", nameFrom: "shortText(el)" },
        { select: "h2", as: "view", nameFrom: "shortText(el)" },
        { select: "h3", as: "view", nameFrom: "shortText(el)" },
        { select: "label", as: "view", nameFrom: "shortText(el)" },
        { select: "th", as: "view", nameFrom: "shortText(el)" },
        { select: "td", as: "view", nameFrom: "shortText(el)" },
        { select: "p", as: "view", nameFrom: "shortText(el)" },
        { select: "img[alt]", as: "view", nameFrom: "(el.alt || '').trim().slice(0,60)" },
        { select: "figcaption", as: "view", nameFrom: "shortText(el)" },
        { select: "[aria-label]", as: "view", nameFrom: "(el.getAttribute('aria-label') || '').trim().slice(0,60)" },
        { select: "[aria-describedby]", as: "view", nameFrom: "(el.getAttribute('aria-describedby') || '').trim().slice(0,60)" },
        { select: "span", as: "view", nameFrom: "shortText(el)" },
        { select: "strong", as: "view", nameFrom: "shortText(el)" },
        { select: "em", as: "view", nameFrom: "shortText(el)" },

        // Ignore hidden/unimportant
        { select: "[aria-hidden='true']", as: "ignore" },
        { select: "script", as: "ignore" },
        { select: "style", as: "ignore" },
        { select: "meta", as: "ignore" },
        { select: "link", as: "ignore" },
        { select: "noscript", as: "ignore" },
        { select: "br", as: "ignore" },
        { select: "hr", as: "ignore" },
    ];

    // ── DOM annotation ──────────────────────────────────────────

    /**
     * Walk the DOM tree starting from root and annotate matching elements.
     */
    function bind(root) {
        root = root || document.documentElement;
        annotationOrder = [];
        annotated = new WeakMap();
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
        var all = root.querySelectorAll("*");
        for (var i = 0; i < all.length; i++) {
            var el = all[i];
            if (hasNativeAX(el)) continue;
            if (annotated.has(el)) continue;
            var rule = matchElement(el);
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
            el.setAttribute(prefix + "-ignore", "");
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
