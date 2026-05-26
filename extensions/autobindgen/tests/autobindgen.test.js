import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import autobindgen from "../index.js";
import ax from "../../../src/index.js";
import { JSDOM } from "jsdom";

beforeAll(() => {
    const dom = new JSDOM(
        "<!DOCTYPE html><html><head></head><body></body></html>",
        { url: "http://localhost/" },
    );
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.CustomEvent = dom.window.CustomEvent;
    globalThis.Event = dom.window.Event;
    globalThis.Element = dom.window.Element;
    globalThis.HTMLElement = dom.window.HTMLElement;
    globalThis.HTMLInputElement = dom.window.HTMLInputElement;
    globalThis.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
    globalThis.HTMLSelectElement = dom.window.HTMLSelectElement;
    globalThis.HTMLAnchorElement = dom.window.HTMLAnchorElement;
    globalThis.MutationObserver = dom.window.MutationObserver;
});

// ── Helpers ──────────────────────────────────────────────────────

function assertHas(el, attr, value) {
    const val = el.getAttribute(attr);
    if (value === undefined || value === null) {
        expect(val).not.toBeNull();
    } else {
        expect(val).toBe(value);
    }
}

function assertNotHas(el, attr) {
    expect(el.hasAttribute(attr)).toBe(false);
}

// ── Tests ────────────────────────────────────────────────────────

describe("ax-autobindgen", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        autobindgen.configure({
            prefix: "data-ax",
            builtins: true,
            rules: [],
        });
    });

    // ── Built-in heuristics ──────────────────────────────────────

    describe("built-in heuristics", () => {
        test("annotates <button> as click with textContent name", () => {
            document.body.innerHTML = `<button>Save</button>`;
            autobindgen.bind(document.body);
            const btn = document.querySelector("button");
            expect(btn).toBeTruthy();
            assertHas(btn, "data-ax-click", "Save");
        });

        test("annotates <form> as ctx", () => {
            document.body.innerHTML = `<form id="login"><input/></form>`;
            autobindgen.bind(document.body);
            assertHas(document.querySelector("form"), "data-ax-ctx", "login");
        });

        test("annotates <nav> as ctx with static name", () => {
            document.body.innerHTML = `<nav></nav>`;
            autobindgen.bind(document.body);
            assertHas(
                document.querySelector("nav"),
                "data-ax-ctx",
                "navigation",
            );
        });

        test("annotates <input type='text'> as edit", () => {
            document.body.innerHTML = `<input type="text" />`;
            autobindgen.bind(document.body);
            assertHas(document.querySelector("input"), "data-ax-edit");
        });

        test("annotates <textarea> as edit", () => {
            document.body.innerHTML = `<textarea></textarea>`;
            autobindgen.bind(document.body);
            assertHas(document.querySelector("textarea"), "data-ax-edit");
        });

        test("annotates <select> as edit", () => {
            document.body.innerHTML = `<select><option>A</option></select>`;
            autobindgen.bind(document.body);
            assertHas(document.querySelector("select"), "data-ax-edit");
        });

        test("annotates <h1> as view with textContent", () => {
            document.body.innerHTML = `<h1>Welcome</h1>`;
            autobindgen.bind(document.body);
            assertHas(document.querySelector("h1"), "data-ax-view", "Welcome");
        });

        test("annotates <p> as view", () => {
            document.body.innerHTML = `<p>Hello world</p>`;
            autobindgen.bind(document.body);
            assertHas(
                document.querySelector("p"),
                "data-ax-view",
                "Hello world",
            );
        });

        test("annotates <img alt> as view with alt text", () => {
            document.body.innerHTML = `<img alt="Profile photo" />`;
            autobindgen.bind(document.body);
            assertHas(
                document.querySelector("img"),
                "data-ax-view",
                "Profile photo",
            );
        });

        test("annotates <a href^='http'> as nav with textContent", () => {
            document.body.innerHTML = `<a href="https://example.com">Example</a>`;
            autobindgen.bind(document.body);
            assertHas(document.querySelector("a"), "data-ax-nav", "Example");
        });

        test("annotates <td> as view", () => {
            document.body.innerHTML = `<table><tr><td>Cell</td></tr></table>`;
            autobindgen.bind(document.body);
            assertHas(document.querySelector("td"), "data-ax-view", "Cell");
        });

        test("annotates <label> as view", () => {
            document.body.innerHTML = `<label>Email</label>`;
            autobindgen.bind(document.body);
            assertHas(document.querySelector("label"), "data-ax-view", "Email");
        });

        test("annotates <script> as ignore", () => {
            document.body.innerHTML = `<script>var x = 1;</script>`;
            autobindgen.bind(document.body);
            assertHas(document.querySelector("script"), "data-ax-ignore", "");
        });

        test("annotates <style> as ignore", () => {
            document.body.innerHTML = `<style>body {}</style>`;
            autobindgen.bind(document.body);
            assertHas(document.querySelector("style"), "data-ax-ignore", "");
        });

        test("annotates [aria-hidden='true'] as ignore", () => {
            document.body.innerHTML = `<div aria-hidden="true">hidden</div>`;
            autobindgen.bind(document.body);
            assertHas(document.querySelector("div"), "data-ax-ignore", "");
        });

        test("annotates [onclick] as click", () => {
            document.body.innerHTML = `<div onclick="alert(1)">Click me</div>`;
            autobindgen.bind(document.body);
            assertHas(
                document.querySelector("div"),
                "data-ax-click",
                "Click me",
            );
        });

        test("annotates input[type='submit'] as click with value name", () => {
            document.body.innerHTML = `<input type="submit" value="Go" />`;
            autobindgen.bind(document.body);
            assertHas(document.querySelector("input"), "data-ax-click", "Go");
        });

        test("annotates [contenteditable='true'] as edit", () => {
            document.body.innerHTML = `<div contenteditable="true">Edit me</div>`;
            autobindgen.bind(document.body);
            assertHas(document.querySelector("div"), "data-ax-edit");
        });

        test("annotates <article> as ctx", () => {
            document.body.innerHTML = `<article id="post1"></article>`;
            autobindgen.bind(document.body);
            assertHas(
                document.querySelector("article"),
                "data-ax-ctx",
                "post1",
            );
        });

        test("annotates <section> as ctx", () => {
            document.body.innerHTML = `<section id="hero"></section>`;
            autobindgen.bind(document.body);
            assertHas(document.querySelector("section"), "data-ax-ctx", "hero");
        });

        test("annotates <header> as ctx", () => {
            document.body.innerHTML = `<header></header>`;
            autobindgen.bind(document.body);
            assertHas(
                document.querySelector("header"),
                "data-ax-ctx",
                "header",
            );
        });

        test("annotates <footer> as ctx", () => {
            document.body.innerHTML = `<footer></footer>`;
            autobindgen.bind(document.body);
            assertHas(
                document.querySelector("footer"),
                "data-ax-ctx",
                "footer",
            );
        });

        test("annotates <main> as ctx", () => {
            document.body.innerHTML = `<main></main>`;
            autobindgen.bind(document.body);
            assertHas(document.querySelector("main"), "data-ax-ctx", "main");
        });

        test("form nameFrom fallback to 'form' when no id/name", () => {
            document.body.innerHTML = `<form></form>`;
            autobindgen.bind(document.body);
            assertHas(document.querySelector("form"), "data-ax-ctx", "form");
        });

        test("ctx uses id as name preferentially", () => {
            document.body.innerHTML = `<section id="sidebar"></section>`;
            autobindgen.bind(document.body);
            assertHas(
                document.querySelector("section"),
                "data-ax-ctx",
                "sidebar",
            );
        });
    });

    // ── Configuration ────────────────────────────────────────────

    describe("configure()", () => {
        test("accepts custom rules and applies them", () => {
            autobindgen.configure({
                builtins: false,
                rules: [{ select: ".custom-btn", as: "click", name: "custom" }],
            });
            document.body.innerHTML = `<div class="custom-btn">Go</div>`;
            autobindgen.bind(document.body);
            assertHas(
                document.querySelector(".custom-btn"),
                "data-ax-click",
                "custom",
            );
        });

        test("clears previous rules on configure", () => {
            autobindgen.configure({
                builtins: false,
                rules: [{ select: ".first", as: "click", name: "first" }],
            });
            // Reconfigure with different rules
            autobindgen.configure({
                builtins: false,
                rules: [{ select: ".second", as: "view", name: "second" }],
            });
            document.body.innerHTML = `
                <div class="first">A</div>
                <div class="second">B</div>
            `;
            autobindgen.bind(document.body);

            // first rule was cleared — no annotation
            assertNotHas(document.querySelector(".first"), "data-ax-click");
            assertNotHas(document.querySelector(".first"), "data-ax-ctx");
            assertNotHas(document.querySelector(".first"), "data-ax-view");
            // second rule applied
            assertHas(
                document.querySelector(".second"),
                "data-ax-view",
                "second",
            );
        });

        test("custom prefix works", () => {
            autobindgen.configure({
                prefix: "custom-ns",
                builtins: true,
                rules: [],
            });
            document.body.innerHTML = `<button>Go</button>`;
            autobindgen.bind(document.body);
            assertHas(
                document.querySelector("button"),
                "custom-ns-click",
                "Go",
            );
        });

        test("builtins: false disables all built-in heuristics", () => {
            autobindgen.configure({ builtins: false, rules: [] });
            document.body.innerHTML = `
                <button>Click</button>
                <form></form>
                <h1>Title</h1>
                <input type="text"/>
            `;
            autobindgen.bind(document.body);

            assertNotHas(document.querySelector("button"), "data-ax-click");
            assertNotHas(document.querySelector("form"), "data-ax-ctx");
            assertNotHas(document.querySelector("h1"), "data-ax-view");
            assertNotHas(document.querySelector("input"), "data-ax-edit");
        });

        test("builtins: false still applies user rules", () => {
            autobindgen.configure({
                builtins: false,
                rules: [{ select: "button", as: "click", name: "mybtn" }],
            });
            document.body.innerHTML = `<button>Go</button><h1>No annot</h1>`;
            autobindgen.bind(document.body);
            assertHas(
                document.querySelector("button"),
                "data-ax-click",
                "mybtn",
            );
            assertNotHas(document.querySelector("h1"), "data-ax-view");
        });

        test("missing prefix defaults to 'data-ax'", () => {
            autobindgen.configure({ rules: [], builtins: true });
            document.body.innerHTML = `<button>Go</button>`;
            autobindgen.bind(document.body);
            assertHas(document.querySelector("button"), "data-ax-click");
        });
    });

    // ── addRule ──────────────────────────────────────────────────

    describe("addRule()", () => {
        test("adds a rule without clearing existing rules", () => {
            autobindgen.configure({
                builtins: false,
                rules: [{ select: ".btn", as: "click", name: "btn" }],
            });
            autobindgen.addRule({ select: ".card", as: "ctx", name: "card" });

            document.body.innerHTML = `
                <div class="btn">Click</div>
                <div class="card">Card</div>
            `;
            autobindgen.bind(document.body);
            assertHas(document.querySelector(".btn"), "data-ax-click", "btn");
            assertHas(document.querySelector(".card"), "data-ax-ctx", "card");
        });

        test("addRule without prior configure works", () => {
            // In beforeEach, configure() sets rules=[] and builtins=true.
            // We override with builtins:false so only addRule rules apply.
            autobindgen.configure({ builtins: false, rules: [] });
            autobindgen.addRule({ select: ".only", as: "view", name: "only" });
            document.body.innerHTML = `<div class="only">Hi</div>`;
            autobindgen.bind(document.body);
            assertHas(document.querySelector(".only"), "data-ax-view", "only");
        });
    });

    // ── Priority: user rules > builtins ──────────────────────────

    describe("rule priority", () => {
        test("user rules fire before built-in heuristics", () => {
            autobindgen.configure({
                builtins: true,
                rules: [
                    // Override the built-in <button> → click heuristic
                    { select: "button", as: "view", name: "button-view" },
                ],
            });
            document.body.innerHTML = `<button>Go</button>`;
            autobindgen.bind(document.body);
            // User rule took priority: it's "view" not "click"
            assertHas(
                document.querySelector("button"),
                "data-ax-view",
                "button-view",
            );
            assertNotHas(document.querySelector("button"), "data-ax-click");
        });

        test("first matching user rule wins (no double annotation)", () => {
            autobindgen.configure({
                builtins: false,
                rules: [
                    { select: ".multi", as: "click", name: "click" },
                    { select: ".multi", as: "view", name: "view" },
                ],
            });
            document.body.innerHTML = `<div class="multi">Item</div>`;
            autobindgen.bind(document.body);
            // First matching rule applied
            assertHas(
                document.querySelector(".multi"),
                "data-ax-click",
                "click",
            );
            assertNotHas(document.querySelector(".multi"), "data-ax-view");
        });
    });

    // ── Custom matchers ──────────────────────────────────────────

    describe("addMatcher() — custom matchers", () => {
        test("custom matcher matched via 'match' field", () => {
            autobindgen.addMatcher("testid", function (el, rule) {
                return el.getAttribute("data-testid") === rule.value;
            });
            autobindgen.configure({
                builtins: false,
                rules: [
                    {
                        match: "testid",
                        value: "tweet",
                        as: "ctx",
                        name: "tweet",
                    },
                    {
                        match: "testid",
                        value: "like",
                        as: "click",
                        name: "like",
                    },
                ],
            });
            document.body.innerHTML = `
                <div data-testid="tweet">Hello</div>
                <div data-testid="like">Like</div>
            `;
            autobindgen.bind(document.body);
            assertHas(
                document.querySelector("[data-testid='tweet']"),
                "data-ax-ctx",
                "tweet",
            );
            assertHas(
                document.querySelector("[data-testid='like']"),
                "data-ax-click",
                "like",
            );
        });

        test("missing matcher returns false (no crash)", () => {
            autobindgen.configure({
                builtins: false,
                rules: [
                    { match: "nonexistent", value: "x", as: "ctx", name: "x" },
                ],
            });
            document.body.innerHTML = `<div>Hi</div>`;
            // Should not throw
            expect(() => autobindgen.bind(document.body)).not.toThrow();
        });
    });

    // ── Name resolution ──────────────────────────────────────────

    describe("name resolution", () => {
        test("static 'name' is used directly", () => {
            autobindgen.configure({
                builtins: false,
                rules: [{ select: ".item", as: "view", name: "static-name" }],
            });
            document.body.innerHTML = `<div class="item">Dynamic</div>`;
            autobindgen.bind(document.body);
            assertHas(
                document.querySelector(".item"),
                "data-ax-view",
                "static-name",
            );
        });

        test("nameFrom resolves simple property (el.textContent)", () => {
            autobindgen.configure({
                builtins: false,
                rules: [
                    { select: ".item", as: "view", nameFrom: "el.textContent" },
                ],
            });
            document.body.innerHTML = `<div class="item">Hello World</div>`;
            autobindgen.bind(document.body);
            assertHas(
                document.querySelector(".item"),
                "data-ax-view",
                "Hello World",
            );
        });

        test("nameFrom resolves id property", () => {
            autobindgen.configure({
                builtins: false,
                rules: [{ select: ".item", as: "ctx", nameFrom: "el.id" }],
            });
            document.body.innerHTML = `<div class="item" id="box1"></div>`;
            autobindgen.bind(document.body);
            assertHas(document.querySelector(".item"), "data-ax-ctx", "box1");
        });

        test("nameFrom with fallback expression", () => {
            autobindgen.configure({
                builtins: false,
                rules: [
                    {
                        select: ".item",
                        as: "ctx",
                        nameFrom: "el.id || 'fallback'",
                    },
                ],
            });
            document.body.innerHTML = `<div class="item"></div>`;
            autobindgen.bind(document.body);
            assertHas(
                document.querySelector(".item"),
                "data-ax-ctx",
                "fallback",
            );
        });

        test("nameFrom prefers first truthy in expression", () => {
            autobindgen.configure({
                builtins: false,
                rules: [
                    {
                        select: ".item",
                        as: "ctx",
                        nameFrom: "el.id || el.name || 'unnamed'",
                    },
                ],
            });
            document.body.innerHTML = `<div class="item" id="real-id" name="altname"></div>`;
            autobindgen.bind(document.body);
            // id is truthy, so it wins
            assertHas(
                document.querySelector(".item"),
                "data-ax-ctx",
                "real-id",
            );
        });

        test("nameFrom with aria-label property", () => {
            autobindgen.configure({
                builtins: false,
                rules: [
                    { select: ".item", as: "view", nameFrom: "el.ariaLabel" },
                ],
            });
            document.body.innerHTML = `<div class="item" aria-label="Close dialog"></div>`;
            autobindgen.bind(document.body);
            assertHas(
                document.querySelector(".item"),
                "data-ax-view",
                "Close dialog",
            );
        });

        test("nameFrom throws on bad expression — returns empty string", () => {
            autobindgen.configure({
                builtins: false,
                rules: [
                    {
                        select: ".item",
                        as: "edit",
                        nameFrom: "this.will.throw",
                    },
                ],
            });
            document.body.innerHTML = `<div class="item"></div>`;
            autobindgen.bind(document.body);
            // Falls back to primitive name
            assertHas(document.querySelector(".item"), "data-ax-edit");
        });

        test("name overrides nameFrom when both present", () => {
            autobindgen.configure({
                builtins: false,
                rules: [
                    {
                        select: ".item",
                        as: "click",
                        name: "static",
                        nameFrom: "textContent",
                    },
                ],
            });
            document.body.innerHTML = `<div class="item">Dynamic</div>`;
            autobindgen.bind(document.body);
            // Static name wins
            assertHas(
                document.querySelector(".item"),
                "data-ax-click",
                "static",
            );
        });

        test("ctx falls back to id or 'section' when no name resolved", () => {
            autobindgen.configure({
                builtins: false,
                rules: [{ select: ".item", as: "ctx" }],
            });
            document.body.innerHTML = `<div class="item"></div>`;
            autobindgen.bind(document.body);
            assertHas(
                document.querySelector(".item"),
                "data-ax-ctx",
                "section",
            );
        });
    });

    // ── Native ax preservation ───────────────────────────────────

    describe("native ax-* preservation", () => {
        test("skips elements already annotated with native ax-* attributes", () => {
            document.body.innerHTML = `<button ax-click="native">Native Click</button>`;
            autobindgen.bind(document.body);
            // Should keep the native ax-click, NOT override with data-ax-click
            expect(
                document.querySelector("button").getAttribute("ax-click"),
            ).toBe("native");
            assertNotHas(document.querySelector("button"), "data-ax-click");
        });

        test("skips elements already annotated with native data-ax-* attributes", () => {
            document.body.innerHTML = `<button data-ax-click="already">Already</button>`;
            autobindgen.bind(document.body);
            // Should keep existing annotation
            expect(
                document.querySelector("button").getAttribute("data-ax-click"),
            ).toBe("already");
        });

        test("native ax-* on ancestor does not block annotation of descendant", () => {
            document.body.innerHTML = `
                <div ax-ctx="panel">
                    <button>Click me</button>
                </div>
            `;
            autobindgen.bind(document.body);
            // The div has native ax-ctx — autobindgen skips it
            assertNotHas(document.querySelector("div"), "data-ax-ctx");
            // The button has NO ax-* attributes, so autobindgen annotates it
            assertHas(
                document.querySelector("button"),
                "data-ax-click",
                "Click me",
            );
        });
    });

    // ── unbind cleanup ───────────────────────────────────────────

    describe("unbind()", () => {
        test("removes all data-ax-* annotations applied by bind", () => {
            document.body.innerHTML = `
                <button>Go</button>
                <h1>Title</h1>
            `;
            autobindgen.bind(document.body);
            assertHas(document.querySelector("button"), "data-ax-click");
            assertHas(document.querySelector("h1"), "data-ax-view");

            autobindgen.unbind(document.body);
            assertNotHas(document.querySelector("button"), "data-ax-click");
            assertNotHas(document.querySelector("h1"), "data-ax-view");
        });

        test("unbind does not remove native ax-* attributes", () => {
            document.body.innerHTML = `<button ax-click="native">Go</button>`;
            autobindgen.bind(document.body);
            autobindgen.unbind(document.body);
            expect(
                document.querySelector("button").getAttribute("ax-click"),
            ).toBe("native");
        });

        test("re-bind after unbind re-annotates", () => {
            document.body.innerHTML = `<button>Go</button>`;
            autobindgen.bind(document.body);
            assertHas(document.querySelector("button"), "data-ax-click");

            autobindgen.unbind(document.body);
            assertNotHas(document.querySelector("button"), "data-ax-click");

            autobindgen.bind(document.body);
            assertHas(document.querySelector("button"), "data-ax-click", "Go");
        });

        test("unbind on subtree only removes annotations in that subtree", () => {
            document.body.innerHTML = `
                <div id="a"><button>A</button></div>
                <div id="b"><button>B</button></div>
            `;
            autobindgen.bind(document.body);

            // Only unbind from #a
            autobindgen.unbind(document.querySelector("#a"));

            assertNotHas(document.querySelector("#a button"), "data-ax-click");
            assertHas(
                document.querySelector("#b button"),
                "data-ax-click",
                "B",
            );
        });

        test("unbind with no argument defaults to documentElement", () => {
            document.body.innerHTML = `<button>Go</button>`;
            autobindgen.bind(document.body);
            autobindgen.unbind();
            assertNotHas(document.querySelector("button"), "data-ax-click");
        });
    });

    // ── bind idempotency ────────────────────────────────────────

    describe("bind idempotency", () => {
        test("calling bind twice does not re-annotate same element", () => {
            document.body.innerHTML = `<button>Go</button>`;
            autobindgen.bind(document.body);
            const before = document
                .querySelector("button")
                .getAttribute("data-ax-click");

            autobindgen.bind(document.body);
            const after = document
                .querySelector("button")
                .getAttribute("data-ax-click");

            expect(after).toBe(before);
            // Only one data-ax-* attribute exists
            const dataAxAttrs = Array.from(
                document.querySelector("button").attributes,
            ).filter((a) => a.name.startsWith("data-ax-"));
            expect(dataAxAttrs.length).toBe(1);
        });
    });

    // ── Integration with ax ──────────────────────────────────────

    describe("integration with ax", () => {
        test("ax.scan() works on autobindgen-annotated DOM", () => {
            autobindgen.configure({
                builtins: false,
                rules: [
                    { select: ".container", as: "ctx", name: "container" },
                    { select: ".btn", as: "click", name: "submit" },
                ],
            });
            document.body.innerHTML = `
                <div class="container">
                    <div class="btn">Submit</div>
                </div>
            `;
            autobindgen.bind(document.body);

            const s = ax.scan();
            expect(s.version).toBeGreaterThan(0);

            // ctx creates a scope boundary (no fn entry), click creates a primitive entry
            const names = s.nodes.flatMap((n) => n.fn.map((f) => f.name));
            expect(names).toContain("submit");

            // The btn node should exist and have a parent (the container scope)
            const btnNode = s.nodes.find((n) =>
                n.fn.some((f) => f.name === "submit"),
            );
            expect(btnNode).toBeTruthy();
            // parent should be the container scope node
            expect(btnNode.parent).toBeTruthy();
        });

        test("ax.invoke() triggers default click on autobindgen-annotated button", () => {
            document.body.innerHTML = `<button>Go</button>`;
            autobindgen.bind(document.body);

            let clicked = false;
            const btn = document.querySelector("button");
            btn.addEventListener("click", () => {
                clicked = true;
            });

            const r = ax.invoke(btn, "click");
            expect(r.ok).toBe(true);
            expect(clicked).toBe(true);
        });

        test("ax.invoke() reads view text from autobindgen annotation", () => {
            document.body.innerHTML = `<h1>Hello World</h1>`;
            autobindgen.bind(document.body);

            const el = document.querySelector("h1");
            const r = ax.invoke(el, "view");
            expect(r.ok).toBe(true);
            expect(r.result).toBe("Hello World");
        });
    });

    // ── Exposed internals ────────────────────────────────────────

    describe("exposed internals", () => {
        test("BUILTIN_RULES is exposed and is an array", () => {
            expect(Array.isArray(autobindgen.BUILTIN_RULES)).toBe(true);
            expect(autobindgen.BUILTIN_RULES.length).toBeGreaterThan(0);
            // Each builtin has select, as, and either name or nameFrom
            const first = autobindgen.BUILTIN_RULES[0];
            expect(first.select).toBeTruthy();
            expect(first.as).toBeTruthy();
            expect(
                first.name !== undefined || first.nameFrom !== undefined,
            ).toBe(true);
        });
    });

    // ── Edge cases ───────────────────────────────────────────────

    describe("edge cases", () => {
        test("bind on empty body does not crash", () => {
            document.body.innerHTML = "";
            expect(() => autobindgen.bind(document.body)).not.toThrow();
        });

        test("bind on subtree only annotates elements within that subtree", () => {
            document.body.innerHTML = `
                <div id="outer"><button>Outer</button></div>
                <div id="inner"><button>Inner</button></div>
            `;
            // Only bind to #inner
            autobindgen.bind(document.querySelector("#inner"));

            assertNotHas(
                document.querySelector("#outer button"),
                "data-ax-click",
            );
            assertHas(
                document.querySelector("#inner button"),
                "data-ax-click",
                "Inner",
            );
        });

        test("bind with no argument defaults to documentElement", () => {
            document.body.innerHTML = `<button>Go</button>`;
            autobindgen.bind();
            assertHas(document.querySelector("button"), "data-ax-click", "Go");
        });

        test("invalid CSS selector in rule does not crash bind", () => {
            autobindgen.configure({
                builtins: false,
                rules: [{ select: "[invalid!!!", as: "click", name: "bad" }],
            });
            document.body.innerHTML = `<button>Go</button>`;
            expect(() => autobindgen.bind(document.body)).not.toThrow();
        });

        test("elements with no matching rule get no annotation", () => {
            autobindgen.configure({ builtins: false, rules: [] });
            document.body.innerHTML = `
                <button>Go</button>
                <div>Text</div>
            `;
            autobindgen.bind(document.body);

            const btn = document.querySelector("button");
            const div = document.querySelector("div");
            for (let i = 0; i < btn.attributes.length; i++) {
                expect(btn.attributes[i].name.startsWith("data-ax-")).toBe(
                    false,
                );
            }
            for (let i = 0; i < div.attributes.length; i++) {
                expect(div.attributes[i].name.startsWith("data-ax-")).toBe(
                    false,
                );
            }
        });

        test("element matching builtin ignore rule gets no other annotation", () => {
            document.body.innerHTML = `<script>var x = 1;</script>`;
            autobindgen.bind(document.body);
            // Only data-ax-ignore, nothing else
            const el = document.querySelector("script");
            assertHas(el, "data-ax-ignore", "");
            assertNotHas(el, "data-ax-view");
            assertNotHas(el, "data-ax-click");
            assertNotHas(el, "data-ax-ctx");
            assertNotHas(el, "data-ax-edit");
            assertNotHas(el, "data-ax-nav");
        });

        test("complex page with mixed elements all annotated correctly", () => {
            document.body.innerHTML = `
                <form id="login">
                    <h1>Sign In</h1>
                    <label>Email</label>
                    <input type="email" />
                    <label>Password</label>
                    <input type="password" />
                    <button type="submit">Login</button>
                    <a href="/forgot">Forgot?</a>
                </form>
            `;
            autobindgen.bind(document.body);

            assertHas(document.querySelector("form"), "data-ax-ctx", "login");
            assertHas(document.querySelector("h1"), "data-ax-view", "Sign In");
            assertHas(
                document.querySelector("button"),
                "data-ax-click",
                "Login",
            );

            const inputs = document.querySelectorAll("input");
            expect(inputs.length).toBe(2);
            assertHas(inputs[0], "data-ax-edit");
            assertHas(inputs[1], "data-ax-edit");

            // The "Forgot?" link gets nav annotation (href starts with /)
            // But builtins only catch href^='http' for nav. Let me check:
            // The builtin rule is: { select: "a[href^='http']", as: "nav", ... }
            // "http" won't match "/forgot". But "a[href]" matches click.
            // So <a href="/forgot"> gets click from a[href] builtin AND also a[href^='http']
            // Wait, "a[href]" would match too (builtin line 55)
            // a[href] matches click, a[href^='http'] doesn't match "/forgot"
            // So it should get click annotation
            assertHas(document.querySelector("a"), "data-ax-click", "Forgot?");
        });
    });
});
