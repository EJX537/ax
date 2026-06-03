import { beforeAll, describe, expect, test } from "bun:test";
import autobindgen from "../index.js";
import ax from "../../../src/index.js";
import { JSDOM } from "jsdom";
import fs from "fs";

let aboutLink, storeLink;

beforeAll(() => {
    const html = fs.readFileSync("/tmp/google-dom", "utf8");
    const dom = new JSDOM(html, { url: "https://www.google.com/" });

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
    globalThis.Node = dom.window.Node;

    // Run autobindgen
    autobindgen.configure({ prefix: "data-ax", builtins: true, rules: [] });
    autobindgen.bind(document.body);

    aboutLink = document.querySelector('a.w5hRs');
    storeLink = document.querySelectorAll('a.w5hRs')[1];
});

describe("Google DOM nav links", () => {
    test("About link exists", () => {
        expect(aboutLink).toBeTruthy();
        expect(aboutLink.textContent?.trim()).toBe("About");
    });

    test("About link gets nav='About' not nav='a'", () => {
        const nav = aboutLink.getAttribute("data-ax-nav");
        expect(nav).toBe("About");
        expect(nav).not.toBe("a");
    });

    test("About link is not 'a' (tagName fallback)", () => {
        expect(aboutLink.getAttribute("data-ax-nav")).not.toBe("a");
    });

    test("Store link gets nav='Store' not nav='a_2'", () => {
        const nav = storeLink.getAttribute("data-ax-nav");
        expect(nav).toBe("Store");
        expect(nav).not.toBe("a_2");
    });

    test("All nav links have meaningful names (not tagName fallback)", () => {
        const links = document.querySelectorAll('a.w5hRs');
        for (const link of links) {
            const nav = link.getAttribute("data-ax-nav");
            const tagName = link.tagName.toLowerCase();
            const text = link.textContent.trim();
            // nav should never be just "a" or "a_2", "a_3" etc
            const isTagFallback = /^a(_\d+)?$/.test(nav);
            if (isTagFallback) {
                console.log(`  BAD: <${tagName}>${text}</${tagName}> → nav="${nav}"`);
            }
            expect(isTagFallback).toBe(false);
            // nav should include the text content or be from hostname/pathname
            expect(nav?.length).toBeGreaterThanOrEqual(2);
        }
    });

    test("ax.scan() tree includes nav names", () => {
        const tree = ax.scan(document.body);
        const navNames = tree.nodes.flatMap(n => n.fn.filter(f => f.on === "nav").map(f => f.name));
        expect(navNames).toContain("About");
        expect(navNames).toContain("Store");
        // Should NOT contain "a" as a nav name
        expect(navNames).not.toContain("a");
    });

    test("no element has tagName fallback for nav", () => {
        const allNavs = document.querySelectorAll("[data-ax-nav]");
        for (const el of allNavs) {
            const val = el.getAttribute("data-ax-nav");
            const tag = el.tagName.toLowerCase();
            const isFallback = /^a(_\d+)?$/.test(val);
            if (isFallback) {
                console.log(`  FALLBACK: <${tag}>${el.textContent.trim()}</${tag}> → "${val}"`);
            }
            expect(isFallback).toBe(false);
        }
    });
});
