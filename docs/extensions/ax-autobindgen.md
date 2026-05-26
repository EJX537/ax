# ax-autobindgen

**Heuristic annotation engine for non-ax pages.**

ax-autobindgen walks the DOM of any website and applies `data-ax-*` attributes based on configurable rules. Once annotated, the page works with `ax.scan()` and `ax.invoke()` as if the author had written `ax-*` natively.

This is a **client-side tool** for agent harnesses and browser automations that need to interact with third-party websites that don't use ax. It lives purely on the client — never shipped by the page itself.

---

## Quick start

```js
import axAutobindgen from "./extensions/ax-autobindgen.js";
import ax from "./src/index.js";

// Use built-in heuristics only — no config needed
axAutobindgen.bind(document.body);

const dag = ax.scan();
// dag now contains nodes for forms, buttons, inputs,
// headings, links, tables, etc.
```

---

## How it works

1. Walk every element in the DOM tree
2. For each element, test against **user rules** (first) then **built-in heuristics** (fallback)
3. On first match, apply the corresponding `data-ax-*` attribute
4. Skip elements that already have native `ax-*` or `data-ax-*` — page-authored annotations take priority
5. Track annotated elements in a WeakMap for clean `unbind()`

The result is a DOM that `ax.scan()` compiles into a DAG, even though no page author wrote ax annotations.

---

## Built-in heuristics

The bundled defaults cover common HTML semantics. They fire as **fallback** — only when no user rule matches first.

| Pattern | Annotation | Name source |
|---|---|---|
| `<form>`, `<nav>`, `<main>`, `<header>`, `<footer>` | `data-ax-ctx` | `el.id \|\| el.name \|\| 'form'` |
| `<article>`, `<section>`, `<table>` | `data-ax-ctx` | `el.id \|\| 'article'` |
| `<dialog>`, `[role='dialog']` | `data-ax-ctx` | `'dialog'` |
| `<button>`, `<a>`, `[role='button']`, `[onclick]` | `data-ax-click` | `el.textContent` |
| `input[type='submit']`, `input[type='button']` | `data-ax-click` | `el.value` |
| `<a[href^='http']>`, `[role='link']` | `data-ax-nav` | `el.textContent` |
| `<input>` (non-hidden/non-button), `<textarea>`, `<select>` | `data-ax-edit` | *(none — ax derives from native HTML)* |
| `[contenteditable='true']` | `data-ax-edit` | *(none)* |
| `<h1>`–`<h3>`, `<p>`, `<label>`, `<span>`, `<strong>`, `<em>` | `data-ax-view` | `el.textContent` |
| `<th>`, `<td>` | `data-ax-view` | `el.textContent` |
| `<img[alt]>`, `<figcaption>` | `data-ax-view` | `el.alt` / `el.textContent` |
| `[aria-label]`, `[aria-describedby]` | `data-ax-view` | `el.ariaLabel` / `el.getAttribute('aria-describedby')` |
| `[aria-hidden='true']`, `<script>`, `<style>`, `<noscript>` | `data-ax-ignore` | *(none)* |

---

## Configuration

### Static config object

```js
axAutobindgen.configure({
  builtins: true,          // keep built-in fallback heuristics (default: true)
  prefix: "data-ax",       // annotation prefix (default: "data-ax")
  rules: [
    { select: "button",     as: "click", nameFrom: "el.textContent" },
    { select: "form",       as: "ctx",   nameFrom: "el.id || el.name || 'form'" },
  ]
});
```

### Loading from a JSON file

```js
const resp = await fetch("/rules/twitter.json");
axAutobindgen.configure(await resp.json());
axAutobindgen.bind(document.body);
```

### Rule object

| Field | Type | Required | Description |
|---|---|---|---|
| `select` | `string` | yes* | CSS selector to match elements |
| `match` | `string` | yes* | Name of a custom matcher (see below) |
| `value` | `any` | for custom matchers | Passed to the matcher function |
| `as` | `string` | yes | Primitive type: `"ctx"`, `"click"`, `"edit"`, `"view"`, `"nav"`, `"ignore"` |
| `name` | `string` | no | Static name for the capability |
| `nameFrom` | `string` | no | JS expression evaluated against the element (e.g. `"el.textContent"`, `"el.id || 'unnamed'"`) |

*\*Either `select` or `match` is required.*

---

## Name resolution

When ax compiles the DAG, each node needs a `name` (the label the agent uses to reference the element). autobindgen provides two ways:

**Static name** — every matched element gets the same label:

```json
{ "select": "[data-testid='like']", "as": "click", "name": "like" }
```

**Dynamic name** — resolved at annotation time from the element:

```json
{ "select": "button", "as": "click", "nameFrom": "el.textContent" }
{ "select": ".card", "as": "ctx", "nameFrom": "el.id || 'card'" }
{ "select": "[aria-label]", "as": "click", "nameFrom": "el.ariaLabel" }
```

`nameFrom` is evaluated as a JS expression with `el` in scope. Common patterns:

| Expression | Resolves to |
|---|---|
| `"el.textContent"` | Element's visible text |
| `"el.id"` | Element's `id` attribute |
| `"el.id \|\| 'unnamed'"` | Element's id, or fallback string |
| `"el.value"` | For input elements |
| `"el.alt"` | For images |
| `"el.ariaLabel"` | ARIA label |
| `"el.getAttribute('data-testid')"` | Custom attribute |

If `nameFrom` returns an empty/null value, the primitive name is used as fallback.

---

## Custom matchers

Not every pattern can be expressed with a CSS selector. Custom matchers let you use arbitrary logic.

```js
axAutobindgen.addMatcher("testid", function(el, rule) {
  return el.getAttribute("data-testid") === rule.value;
});
```

Then reference it in rules:

```json
{ "match": "testid", "value": "tweet", "as": "ctx", "name": "tweet" }
{ "match": "testid", "value": "like", "as": "click", "name": "like" }
```

### Built-in matchers

*(None currently — matchers are user-defined.)*

---

## Site-specific examples

### Twitter / X

Rules based on `data-testid` attributes:

```js
axAutobindgen.configure({
  rules: [
    { match: "testid", value: "tweet",     as: "ctx",  name: "tweet" },
    { match: "testid", value: "tweetText", as: "view", nameFrom: "el.textContent" },
    { match: "testid", value: "like",      as: "click", name: "like" },
    { match: "testid", value: "reply",     as: "click", name: "reply" },
    { match: "testid", value: "retweet",   as: "click", name: "retweet" },
    { match: "testid", value: "Bookmark",  as: "click", name: "bookmark" },
  ]
});

axAutobindgen.addMatcher("testid", (el, rule) =>
  el.getAttribute("data-testid") === rule.value
);
```

### Reddit

Rules based on custom elements and slots:

```js
axAutobindgen.configure({
  rules: [
    { select: "shreddit-post",                    as: "ctx",  nameFrom: "el.id" },
    { select: "shreddit-post [slot='title']",      as: "view", nameFrom: "el.textContent" },
    { select: "shreddit-post [slot='byline']",    as: "view", name: "author" },
    { select: "shreddit-post faceplate-tooltip",   as: "click", nameFrom: "el.textContent" },
    { select: "shreddit-post button[upvote]",      as: "click", name: "upvote" },
  ]
});
```

### Generic card layout

```js
axAutobindgen.configure({
  rules: [
    { select: ".card",           as: "ctx",  nameFrom: "el.id || 'card'" },
    { select: ".card-title",     as: "view", nameFrom: "el.textContent" },
    { select: ".card-description", as: "view", nameFrom: "el.textContent" },
    { select: ".btn-primary",    as: "click", nameFrom: "el.textContent" },
    { select: ".card a",         as: "click", nameFrom: "el.textContent" },
  ]
});
```

---

## API Reference

### `configure(config)`

Clear all existing rules and set up new ones.

| Param | Type | Default | Description |
|---|---|---|---|
| `config.rules` | `Array` | `[]` | Array of rule objects |
| `config.builtins` | `boolean` | `true` | Enable built-in heuristic fallbacks |
| `config.prefix` | `string` | `"data-ax"` | Attribute prefix for generated annotations |

### `addRule(rule)`

Append a single rule (does not clear existing rules).

### `addMatcher(name, fn)`

Register a custom matcher for use in rule `"match"` fields.

| Param | Type | Description |
|---|---|---|
| `name` | `string` | Identifier referenced in rule's `match` field |
| `fn` | `(el: Element, rule: Rule) => boolean` | Returns true if the element matches |

### `bind(root?)`

Walk the DOM and apply annotations. Skips elements already annotated or already using native `ax-*`.

| Param | Type | Default | Description |
|---|---|---|---|
| `root` | `Element` | `document.documentElement` | Root of the subtree to annotate |

### `unbind(root?)`

Remove all annotations applied by previous `bind()` calls.

| Param | Type | Default | Description |
|---|---|---|---|
| `root` | `Element` | `document.documentElement` | Root of the subtree to clean |

### `BUILTIN_RULES`

The array of built-in heuristic rule objects (read-only, ~30 rules).

---

## Design notes

- **DOM-first** — applies `data-ax-*` attributes to the live DOM; `ax.scan()` reads them natively. No separate DAG generator needed.
- **Non-destructive** — does not mutate element content, only adds `data-ax-*` attributes. `unbind()` removes them cleanly.
- **Native ax takes priority** — if an element already has `ax-*` or `data-ax-*`, autobindgen skips it. Page-authored annotations are always authoritative.
- **Single-match** — each element binds to the first matching rule. User rules are tested before built-in fallbacks.
- **No runtime dependency on ax** — the extension is self-contained. It pairs with ax core but doesn't import it.
