/**
 * Test environment setup — bootstraps jsdom so ax can run its DOM logic.
 * Run before every test file via bunfig.toml `test.setupFiles`.
 */

import { JSDOM } from "jsdom";

const dom = new JSDOM(
    "<!DOCTYPE html><html><head></head><body></body></html>",
    {
        url: "http://localhost/",
    },
);

globalThis.window = dom.window;
globalThis.document = window.document;
globalThis.CustomEvent = window.CustomEvent;
globalThis.Event = window.Event;
globalThis.Element = window.Element;
globalThis.HTMLElement = window.HTMLElement;
