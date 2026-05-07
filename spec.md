# AX Specification



## Philosophy

AX is a semantic annotation schema for HTML. It makes web pages readable and actionable by AI agents without changing how those pages look or behave for human users.

AX follows three principles:

- **HTML is the contract** — attributes are the entire interface. No JSON schemas, no separate config files.
- **Dumb by design** — `ax.js` annotates and exposes the DOM. It does not contain intelligence. The client does.
- **Progressive enhancement** — a page without an AX-aware client works exactly as before. Adding `ax-*` attributes is purely additive.

---

## Core Concepts

### The Page is the Server

An AX-annotated page declares what it contains, what actions it supports, and what it can receive. It does not execute anything. It is a self-describing interface — like an API spec baked into the markup.

### The Client is the Agent

The plugin, extension, or runtime that reads AX attributes is responsible for all intelligence — deciding when to read, which skills to invoke, what to write back. The client reads the DOM directly. Scroll, jump-to, focus, and all interaction mechanics are the client's responsibility.

### Scopes

`ax-content` is a filter label. It names a region of the page so the client can target it directly. It does not interrupt the template pipeline or bound the DAG walk — it is purely a client-side filtering mechanism.

A scope is implied by `ax-view` and can be explicitly named with `ax-content` when a region contains multiple primitives or when scope needs to be decoupled from interaction.

### Template Pipeline

`ax-template` is chainable from child to parent. The pipeline is a DAG walk — each node applies its transform and passes the result up to the nearest primitive. `ax-content` scope boundaries do not interrupt this walk.

Built-in templates: `view`, `item`, `skill`, `field`. Everything else is registered by the plugin or defined inline as a raw string lambda.

### Required Labels

Every `ax-*` primitive must have a value. `ax.js` throws if a primitive is missing its name. Anonymous primitives are not valid.

```html
<!-- valid -->
<button ax-click="summarize">
<div ax-view="article">
<input ax-edit="title" type="text" />

<!-- throws -->
<button ax-click>
<div ax-view>
<input ax-edit>
```

The only exception is `ax-ignore`, which is presence-only by design.

---

## Primitives

AX has four interaction primitives. All other behaviors are extensions built on top of these.

`ax-click`, `ax-edit`, and `ax-nav` construct agent skill calls. They walk their own subtree collecting templates. `ax-view` describes readable content.

| Primitive | Direction | Default Template | Child Default |
|---|---|---|---|
| `ax-view` | agent reads | `view` | `item` |
| `ax-click` | agent triggers | `skill` | — |
| `ax-edit` | agent writes | `skill` | `field` |
| `ax-nav` | agent navigates | `skill` | — |

---

## Attributes

### `ax-view`

Marks an element as readable by the agent. Implicitly defines a scope — all `ax-*` descendants belong to this scope unless a nested `ax-view` or `ax-content` overrides it.

```html
<ul ax-view="todo list">
  <li>Buy milk</li>
  <li>Write code</li>
</ul>
```

Root `ax-view` defaults to `view`. Children inside a parent `ax-view` default to `item` — no attribute needed on each child.

Produces:
```js
view("todo list", [item(li0), item(li1)])
```

A nested `ax-view` creates a new scope:

```html
<div ax-view="page">
  <article ax-view="article">  <!-- item inside "page", view of its own scope -->
    <p>...</p>                 <!-- item inside "article" -->
  </article>
</div>
```

Override at any level with `ax-template`:

```html
<ul ax-view="todo list" ax-template="skill">
<li ax-template="(e) => e.toUpperCase()">Buy milk</li>
```

---

### `ax-click`

Marks an element as triggerable by the agent. Constructs a skill call. Defaults to `skill`.

```html
<button ax-click="summarize">Summarize</button>
```

With a template override:

```html
<button ax-click="summarize" ax-template="(e) => e.trim(20)">Summarize</button>
```

Produces:
```js
skill("summarize", transform(e => e.trim(20), element))
```

---

### `ax-edit`

Marks an element as writable by the agent. Constructs a skill call. Input type is inferred from the native HTML element and `type` attribute — `ax.js` does not need to be told. Applies to `input`, `textarea`, `select`, radio groups, checkboxes, and file uploads.

```html
<input ax-edit="title" type="text" />
<textarea ax-edit="body"></textarea>
<select ax-edit="status">...</select>
<input ax-edit="attachment" type="file" />
<input ax-edit="active" type="checkbox" />
```

When applied to a container, `ax-edit` defines a named scope and defaults to `skill`. Children with `ax-edit` inside that container default to `field`.

```html
<form ax-edit="notes">                    <!-- skill("notes", [...]) -->
  <input ax-edit="title" type="text" />  <!-- field("title", input) -->
  <textarea ax-edit="body"></textarea>   <!-- field("body", textarea) -->
  <button ax-click="save">Save</button>  <!-- skill("save") — submission is ax-click -->
</form>
```

Produces:
```js
skill("notes", [
  field("title", input),
  field("body", textarea)
])
```

A standalone `ax-edit` outside any parent `ax-edit` always defaults to `skill`:

```html
<input ax-edit="quick note" type="text" />  <!-- skill("quick note", input) -->
```

---

### `ax-nav`

Marks an element as a navigation target. Constructs a skill call. Semantically distinct from `ax-click` — signals to the client that following this changes the agent's context. Defaults to `skill`.

```html
<a ax-nav="next page" href="/page/2">Next</a>
```

Carries an optional `ax-swap` hint describing the expected context change. A hint to the client — not a directive.

```html
<a ax-nav="next page" ax-swap="page" href="/page/2">Next</a>
<a ax-nav="load more" ax-swap="region" href="/items?page=2">Load more</a>
<a ax-nav="preview" ax-swap="modal" href="/preview">Preview</a>
```

Suggested `ax-swap` values: `page`, `region`, `modal`. The client may define additional values.

---

### `ax-content`

A filter label for the client. Names a region of the page so the client can target or filter by scope. Does not define interaction, does not interrupt the template pipeline.

```html
<!-- implicit scope via ax-view -->
<ul ax-view="todo list">

<!-- explicit filter label with multiple primitives -->
<ul ax-content="todo list" ax-view="view todos" ax-edit="edit todos">
```

- Value is a scope name (string identifier)
- Scopes nest naturally — innermost is always active
- Only needed when `ax-view` alone does not express the full scope intent

---

### `ax-template`

Declares a transformer for an element's content. Chainable from child to parent — each element's transform is applied before the result is passed up to the nearest primitive. The pipeline is a DAG walk and is not interrupted by scope boundaries.

Supports two forms:

```html
<!-- named built-in or plugin-registered -->
<div ax-template="skill">
<div ax-template="myCustomTemplate">

<!-- inline lambda — raw string, client evaluates, ax.js does not -->
<div ax-template="(e) => `${Date.now()}: ${e}`">
```

Built-ins shipped with `ax.js`:

| Name | Default for |
|---|---|
| `view` | `ax-view` root |
| `item` | `ax-view` child inside parent `ax-view` |
| `skill` | `ax-click`, `ax-nav`, `ax-edit` root |
| `field` | `ax-edit` child inside parent `ax-edit` |

The plugin can register additional named templates. Inline lambdas are raw strings — `ax.js` never evaluates them. The client is responsible for interpretation. This keeps `ax.js` dumb and avoids XSS surface area.

Resolution order: `ax-template` on element → context-sensitive default → `skill`.

---

### `ax-for`

Routes a template to a named primitive instead of the nearest parent. By convention should target the nearest parent. Can target any named `ax-*` in the current scope — discouraged when not targeting the nearest parent as it breaks natural tree composition.

```html
<ul ax-content="todo list" ax-view="view todos" ax-edit="edit todos">
  <div ax-template="skill" ax-for="edit todos">
    <div ax-template="(e) => `${Date.now()}: ${e}`">Today's Todo</div>
    <div ax-template="(e) => e.trim(20)">Description</div>
  </div>
  <li>...</li>
</ul>
```

---

### `ax-ignore`

Excludes an element and all its descendants from AX entirely. The agent will not see, read, or interact with ignored elements. No value required.

```html
<ul ax-view="todo list">
  <li ax-ignore>Draft — not ready</li>
  <li>Visible item</li>
</ul>
```

---

## Template Pipeline

Templates compose bottom-up. Each child applies its own transform and passes the result to its parent. The walk stops at the nearest primitive.

```html
<ul ax-content="todo list" ax-view="view todos" ax-edit="edit todos">
  <div ax-template="skill" ax-for="edit todos">
    <div ax-template="(e) => `${Date.now()}: ${e}`">Today's Todo</div>
    <div ax-template="(e) => e.trim(20)">Some description</div>
  </div>
  <li ax-ignore>...</li>
  <li>...</li>
</ul>
```

Produces:
```js
view("todo list", [
  skill("edit todos", [
    transform(e => `${Date.now()}: ${e}`, "Today's Todo"),
    transform(e => e.trim(20), "Some description")
  ]),
  item(li1)
])
```

---

## Content Elements

Context and metadata can be provided via any natively hidden element. AX supports all of the following as long as `ax-*` attributes are present:

```html
<meta ax-template="..." content="..." hidden>
<data ax-template="..." value="..." hidden>
<p ax-template="..." hidden>...</p>
<span ax-template="..." hidden>...</span>
```

AX does not prescribe how elements are hidden from users. Use the native `hidden` attribute or CSS — AX does not care as long as the attributes are respected.

---

## Scoping Rules

`ax-content` is a filter label. The client uses it to target a named region. Scope boundaries do not affect the template pipeline.

```html
<div ax-view="page">

  <div ax-view="article">
    <!-- active scope: article -->
    <button ax-click="summarize"></button>
  </div>

  <div ax-view="sidebar">
    <!-- active scope: sidebar -->
    <a ax-nav="related posts" href="/related"></a>
  </div>

</div>
```

- Innermost scope is always active
- Outer scope is available as parent context but does not override inner
- `ax-ignore` is the only way to fully exclude an element from its scope
- Every primitive must have a name — `ax.js` throws on missing values

---

## Error Handling

AX delegates error handling to native HTML validation. There is no `ax-error` attribute.

Native form validation provides everything the agent needs:

- `required`, `minlength`, `pattern`, `type` — constraints live on the same element as `ax-edit`
- `invalid` event — fires natively when a constraint fails
- `element.validity` — describes exactly what failed

`ax.js` forwards native `invalid` events as `ax:error` on the relevant element.

For custom or business logic errors, the page dispatches `invalid` directly:

```js
input.dispatchEvent(new CustomEvent('invalid', {
  detail: { reason: 'username-taken' }
}))
```

`ax.js` forwards this as `ax:error` the same way.

---

## Client Events

The client communicates back to the page via standard `CustomEvent` fired on the relevant element. The page can listen or ignore — no special AX machinery required.

```js
element.dispatchEvent(new CustomEvent('ax:start'))
element.dispatchEvent(new CustomEvent('ax:done'))
element.dispatchEvent(new CustomEvent('ax:error', { detail: { reason } }))
```

Pages that want to respond to agent activity listen normally:

```js
document.querySelector('[ax-click="summarize"]')
  .addEventListener('ax:done', () => { ... })
```

---

## Minimal Example

```html
<script src="ax.js"></script>

<main ax-view="article">
  <meta hidden ax-template="(e) => `Blog post: ${e}`" content="History of the Web">

  <article>
    <h1>The History of the Web</h1>
    <p>...</p>
  </article>

  <div ax-view="summary"></div>

  <button ax-click="summarize">Summarize</button>

  <form ax-edit="notes">
    <input ax-edit="title" type="text" required placeholder="Title" />
    <textarea ax-edit="body"></textarea>
    <button ax-click="save" type="submit">Save</button>
  </form>
</main>
```

---

## Extensions

AX is extensible via `ax.defineTemplate` and `ax.definePrimitive`. Extensions are additive — they cannot override built-ins.

### Custom Templates

Register a named template the client can reference via `ax-template`:

```js
ax.defineTemplate("shorten", (e) => e.slice(0, 100))
ax.defineTemplate("timestamp", (e) => `${Date.now()}: ${e}`)
```

Used in markup:

```html
<div ax-template="shorten">Some long content</div>
```

### Custom Primitives

Register a new `ax-*` attribute as a primitive. Provide a default template and any metadata the client needs:

```js
ax.definePrimitive("ax-highlight", { default: "skill" })
ax.definePrimitive("ax-stream", { default: "view" })
```

Used in markup:

```html
<div ax-highlight="important section">...</div>
```

Custom primitives follow the same rules as built-in ones — they require a value, support `ax-template` overrides, and participate in the template pipeline.

---

## Imperative API

### Autoscan

`ax.js` does not autoscan. AX is a passive schema — attributes are just markup. Nothing needs to be initialized, wired, or eagerly built. The client drives all reads.

On `DOMContentLoaded`, `ax.js` only:
1. **Validates** — throws on any `ax-*` primitive missing a value
2. **Starts a `MutationObserver`** — watches for DOM changes to invalidate cache

No tree is built. No processing happens. The client calls `ax.get()` or `ax.scan()` on demand.

### Caching

`ax.js` caches lazily. On first call, it walks the DOM, builds the result, hashes the subtree, and stores it. On subsequent calls the cache is returned directly. When the DOM mutates, the `MutationObserver` invalidates affected cache entries — the next call rebuilds only what changed.

```
ax.get("todo list")
  → cache hit  → return cached result
  → cache miss → walk DOM, hash + store, return
DOM mutates   → observer invalidates affected entries
ax.get("todo list") → rebuild only what changed
```

`ax.process(element)` is the manual trigger to prime or refresh the cache for a subtree. Useful after a framework mount but never required by `ax.js` itself.

### Reading the AX Tree

```js
// full AX tree from the document
ax.scan()

// get a named scope by ax-content or ax-view name — lazy, cached
ax.get("todo list")
// → { element, primitives, children }

// walk the template DAG from a node, returns composed result
ax.walk(element)

// manually prime or refresh cache for a subtree
ax.process(element)
```

### Framework Integration

`ax.js` does not ship framework adapters. Frameworks render normally — the DOM is still the contract. Call `ax.process()` after mount only if you want to prime the cache eagerly. Otherwise the first `ax.get()` call handles it lazily.

**React:**

```jsx
const ref = useRef()
useEffect(() => ax.process(ref.current), []) // optional — primes cache on mount

return (
  <ul ref={ref} ax-view="todo list">
    <li>Buy milk</li>
    <li>Write code</li>
  </ul>
)
```

**Vue:**

```vue
<template>
  <ul ax-view="todo list" ref="list">
    <li>Buy milk</li>
  </ul>
</template>

<script setup>
import { ref, onMounted } from 'vue'
const list = ref(null)
onMounted(() => ax.process(list.value)) // optional — primes cache on mount
</script>
```

For dynamic content, the `MutationObserver` handles cache invalidation automatically. No manual intervention needed.

---

## What AX is Not

- **Not a UI framework** — it does not render or manage components
- **Not an agent runtime** — it does not execute skills or call LLMs
- **Not opinionated about the client** — any client that can read the DOM and understands the AX schema is a valid AX client
- **Not a replacement for ARIA** — AX is for agent interoperability, ARIA is for accessibility. They coexist.
- **Not window-dependent** — `ax.js` does not assume or require a `window.ax` interface. The client reads the DOM directly.
