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

    /** Built-in heuristic rules for common HTML patterns.
     *  These fire when no explicit rule catches an element first. */
    var BUILTIN_RULES = [
        // Structural contexts
        { select: "form", as: "ctx", nameFrom: "el.id || el.name || 'form'" },
        { select: "nav", as: "ctx", name: "navigation" },
        { select: "main", as: "ctx", name: "main" },
        { select: "header", as: "ctx", name: "header" },
        { select: "footer", as: "ctx", name: "footer" },
        { select: "table", as: "ctx", nameFrom: "el.id || 'table'" },
        { select: "article", as: "ctx", nameFrom: "el.id || 'article'" },
        { select: "section", as: "ctx", nameFrom: "el.id || 'section'" },
        { select: "[role='dialog']", as: "ctx", name: "dialog" },
        { select: "[role='main']", as: "ctx", name: "main" },
        { select: "[role='navigation']", as: "ctx", name: "navigation" },

        // Navigation (external links)
        { select: "a[href^='http']", as: "nav", nameFrom: "el.textContent" },
        { select: "[role='link']", as: "nav", nameFrom: "el.textContent" },

        // Clickable elements
        { select: "button", as: "click", nameFrom: "el.textContent" },
        {
            select: "button[type='submit']",
            as: "click",
            nameFrom: "el.textContent",
        },
        {
            select: "a[href]:not([href^='http'])",
            as: "click",
            nameFrom: "el.textContent",
        },
        { select: "input[type='submit']", as: "click", nameFrom: "el.value" },
        { select: "input[type='button']", as: "click", nameFrom: "el.value" },
        { select: "[role='button']", as: "click", nameFrom: "el.textContent" },
        { select: "[onclick]", as: "click", nameFrom: "el.textContent" },

        // Editable inputs
        {
            select: "input:not([type='hidden']):not([type='submit']):not([type='button'])",
            as: "edit",
        },
        { select: "textarea", as: "edit" },
        { select: "select", as: "edit" },
        { select: "[contenteditable='true']", as: "edit" },

        // Viewable text
        { select: "h1", as: "view", nameFrom: "el.textContent" },
        { select: "h2", as: "view", nameFrom: "el.textContent" },
        { select: "h3", as: "view", nameFrom: "el.textContent" },
        { select: "label", as: "view", nameFrom: "el.textContent" },
        { select: "th", as: "view", nameFrom: "el.textContent" },
        { select: "td", as: "view", nameFrom: "el.textContent" },
        { select: "p", as: "view", nameFrom: "el.textContent" },
        { select: "img[alt]", as: "view", nameFrom: "el.alt" },
        { select: "figcaption", as: "view", nameFrom: "el.textContent" },
        { select: "[aria-label]", as: "view", nameFrom: "el.ariaLabel" },
        {
            select: "[aria-describedby]",
            as: "view",
            nameFrom: "el.getAttribute('aria-describedby')",
        },
        { select: "span", as: "view", nameFrom: "el.textContent" },
        { select: "strong", as: "view", nameFrom: "el.textContent" },
        { select: "em", as: "view", nameFrom: "el.textContent" },

        // Ignore hidden/unimportant
        { select: "[aria-hidden='true']", as: "ignore" },
        { select: "script", as: "ignore" },
        { select: "style", as: "ignore" },
        { select: "noscript", as: "ignore" },
    ];

    /** Registered rules — user config + builtins */
    var rules = [];

    /** Custom matchers keyed by name */
    var matchers = {};

    /** Currently annotated elements WeakMap (el → true) for cleanup */
    var annotated = new WeakMap();

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
        var val;
        try {
            val = new Function("el", "return " + rule.nameFrom)(el);
        } catch {
            val = "";
        }
        if (val && typeof val === "string") return val.trim();
        return "";
    }

    // ── Matcher registry ────────────────────────────────────────

    /**
     * Register a custom matcher that specific rules can reference.
     * The matcher receives (el, rule) and returns true if the element matches.
     *
     * Example:
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
     * - `nameFrom`: JS expression to derive name from el (e.g. "el.textContent")
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
        // User-configured rules first
        for (var i = 0; i < rules.length; i++) {
            if (testRule(el, rules[i])) return rules[i];
        }
        // Built-in rules as fallback
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
            // Custom matcher
            var fn = matchers[rule.match];
            if (fn) return fn(el, rule);
            return false;
        }
        if (rule.select) {
            // CSS selector — use matches() (aka matchesSelector)
            try {
                return el.matches(rule.select);
            } catch {
                return false;
            }
        }
        return false;
    }

    // ── DOM annotation ──────────────────────────────────────────

    /**
     * Walk the DOM tree starting from root and annotate matching elements.
     * Skips elements that already have native ax-* attributes (page uses ax).
     * Skips elements already annotated by bindgen.
     */
    function bind(root) {
        root = root || document.documentElement;
        var all = root.querySelectorAll("*");
        for (var i = 0; i < all.length; i++) {
            var el = all[i];

            // Skip if element already has native ax-* annotations
            // (page is already ax-aware — let its own annotations speak)
            if (hasNativeAX(el)) continue;

            // Skip if already annotated by bindgen
            if (annotated.has(el)) continue;

            var rule = matchElement(el);
            if (!rule) continue;

            // Apply the annotation
            applyAnnotation(el, rule);
            annotated.set(el, true);
        }
    }

    /**
     * Check if element has native ax-* or data-ax-* attributes.
     */
    function hasNativeAX(el) {
        // If the element itself has any ax-* attribute, it's native
        for (var i = 0; i < el.attributes.length; i++) {
            var name = el.attributes[i].name;
            if (name.startsWith("ax-")) return true;
            if (name.startsWith("data-ax-")) return true;
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

        // For ctx primitives, use id or fallback
        if (rule.as === "ctx") {
            el.setAttribute(attr, name || el.id || "section");
            return;
        }

        el.setAttribute(attr, name || rule.as);
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
                // Remove all data-ax-* attributes we might have set
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

        /** Expose builtins for inspection */
        BUILTIN_RULES: BUILTIN_RULES,
    };
})();

export default axAutobindgen;
