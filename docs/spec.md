# AX Core Specification

## Definition

**AX is a semantic annotation layer where the DOM is the contract between a webpage and an agent interface.**

AX is not an agent runtime. It does not make decisions. It compiles annotated DOM into a client-usable model and executes lifecycle hooks that the page promises to the client.

---

## 1) Core Goals

1. **DOM Contract**: `ax-*` (and `data-ax-*`) attributes are the source of truth
2. **Element-Centric Compilation**: one element → one node with an array of function descriptors (`fn`), not one node per primitive
3. **Promise-Based Hooks**: `ax-on*` is the page promising behavior; AX evaluates it (HTMX-style eval) when the client invokes
4. **Action Lifecycle**: before / on / after phases around capabilities
5. **Extensions as First-Class Citizens**
6. **Low Complexity**: built-in systems belong in extensions, not core

---

## 2) Core Primitives

| Capability | Attribute | Purpose |
|---|---|---|
| view | `ax-view` | readable content |
| click | `ax-click` | triggerable action |
| edit | `ax-edit` | writable field — args derived from native HTML |
| nav | `ax-nav` | navigation action |

Control attributes:

| Attribute | Purpose |
|---|---|
| `ax-ctx` | scope boundary, names a region |
| `ax-ignore` | excludes element subtree from AX |

### Primitive Value Rule

Each capability attribute must have a non-empty name.

```html
<!-- valid -->
<button ax-click="save">Save</button>
<div ax-view="article">...</div>

<!-- invalid -->
<button ax-click>Save</button>
```

### Attribute Naming

All `ax-*` attributes also accept the `data-ax-*` prefix. Hook attributes use camelCase after the phase word:

| Form | Example |
|---|---|
| `ax-*` | `ax-onClick` |
| `data-ax-*` | `data-ax-onClick` |

Dash-separated hook forms (`ax-on-click`, `ax-before-view`) are not supported.

### Scoping

- `<html>` is the implicit root scope
- `ax-ctx` creates a named scope boundary
- Capabilities propagate within scope unless overridden by an inner `ax-ctx` or `ax-ignore`
- `ax-ignore` excludes the element and all descendants from the AX contract

---

## 3) Compilation Model

### Scan Contract

`ax.scan(root?)` walks the DOM and returns a fresh DAG snapshot. The root defaults to `document.documentElement` if omitted.

- Fresh rebuild on every call — no smart-diff caching in core
- Element IDs use `el.id` if present, otherwise AX generates ephemeral fallback IDs

### Output Shape

```ts
type AxScan = {
  version: number
  generatedAt: number
  /** Adjacency map: node id → child node id[] */
  dag: Record<string, string[]>
  /** Serialized node data */
  nodes: AxNode[]
}

type AxNode = {
  /** Node identifier — uses el.id if available, otherwise ephemeral */
  id: string
  /** Parent node id, or null for root */
  parent: string | null
  /** Child node ids */
  children: string[]
  /** Function descriptors for this element's capabilities */
  fn: AxFnEntry[]
}

type AxFnEntry = {
  /** Capability kind: "view" | "click" | "edit" | "nav" | string */
  on: string
  /** Human label from the attribute value */
  name: string
  /** Schema derived from native HTML (edit only) */
  args?: Record<string, string>
}
```

### Element-Centric, Not Primitive-Centric

A single element with both `ax-view` and `ax-click` produces one node with two fn entries:

```html
<div ax-view="price" ax-click="buy Widget">Widget</div>
```

Compiles to:

```json
{
  "id": "price-card",
  "parent": null,
  "children": [],
  "fn": [
    { "on": "view", "name": "price" },
    { "on": "click", "name": "buy Widget" }
  ]
}
```

The client reads the same element differently depending on interaction mode:

- **Read mode**: find `{ on: "view" }` in `fn`
- **Act mode**: find `{ on: "click" }` in `fn`

### Edit Args (Derived from Native HTML)

For `ax-edit`, AX derives an args schema from native HTML attributes, not custom `data-ax-*` equivalents.

| Native attribute | Result |
|---|---|
| `type="text"`, no `required` | `"text?"` |
| `type="text"`, `required` | `"text"` |
| `type="email"`, `required` | `"email"` |
| `type="tel"`, no `required` | `"tel?"` |
| `type="checkbox"`, no `required` | `"checkbox?"` |
| `type="radio"`, no `required` | `"radio?"` |
| `type="password"`, `required` | `"password"` |
| `type="date"`, no `required` | `"date?"` |
| `<select>`, no `required` | `"select?"` |

The `?` suffix marks the field as optional (absent `required` attribute). Aggregate edit schemas on container elements (form, div) collect their descendants' field schemas.

---

## 4) Hook Lifecycle (HTMX-style eval)

`ax-on*` attributes are the **page's promise** to the client. When invoked, AX evaluates them using HTMX-style eval (controlled by `ax.config.allowEval`, defaults to `false`).

### Hook Attribute Mapping

| Attribute | Phase | Applies to |
|---|---|---|
| `ax-beforeClick` / `data-ax-beforeClick` | before | click |
| `ax-onClick` / `data-ax-onClick` | on | click |
| `ax-afterClick` / `data-ax-afterClick` | after | click |
| `ax-beforeView` / `data-ax-beforeView` | before | view |
| `ax-onView` / `data-ax-onView` | on | view |
| `ax-afterView` / `data-ax-afterView` | after | view |
| `ax-beforeEdit` / `data-ax-beforeEdit` | before | edit |
| `ax-onEdit` / `data-ax-onEdit` | on | edit |
| `ax-afterEdit` / `data-ax-afterEdit` | after | edit |
| `ax-beforeNav` / `data-ax-beforeNav` | before | nav |
| `ax-onNav` / `data-ax-onNav` | on | nav |
| `ax-afterNav` / `data-ax-afterNav` | after | nav |

Attributes must be on the same element as the corresponding primitive.

### Hook Evaluation

The attribute value is a JavaScript expression wrapped and called with `ctx`:

```js
new Function("ctx", `return (${raw})(ctx);`)
```

This accepts both function names and inline lambdas:

```html
<!-- Named function -->
<button ax-click="save" ax-onClick="submitForm">Save</button>

<!-- Inline lambda -->
<button ax-click="save" ax-onClick="(ctx) => submitForm(ctx.el.form)">Save</button>
```

### Hook Execution Order

```
extension.beforeAction  →  before hook  →  on hook  →  after hook  →  extension.afterAction
```

- **extension.beforeAction** — first to fire, can cancel via `ctx.canceled = true`
- **before** — guard/cancel. If returns `false`, the chain stops.
- **on** — primary action. Return value becomes `result` in invoke response.
- **after** — post-processing, return value ignored.
- **extension.afterAction** — last to fire.

### Eval Context (`AxInvokeContext`)

```ts
{
  phase: "before" | "on" | "after",
  action: string,
  scope: string,
  el: Element,
  args: any,
  scan: AxScan | null,
  fnEntry: AxFnEntry | undefined,
  hooks: { before?: string, on?: string, after?: string },
  canceled: boolean,
  result: any,
  error?: string
}
```

### Error Propagation

- If a before hook sets `ctx.canceled = true` and `ctx.error = "reason"`, the invoke result includes `{ canceled: true, error: "reason" }`
- If a hook evaluation throws, the error is caught and stored in `ctx.error`
- The error flows through to the invoke result

### allowEval Control

```ts
ax.config.allowEval = true   // enable hook evaluation (HTMX-like)
ax.config.allowEval = false  // hooks silently return undefined (default)
```

---

## 5) Default Behaviors (No on-hook)

When no `ax-on*` hook is present, AX provides sensible defaults:

| Capability | Default behavior |
|---|---|
| view | `el.textContent?.trim() ?? ""` |
| click | `el.click()` (native DOM click) |
| edit | Sets `el.value` (or `.checked` for checkbox/radio) |
| nav | Returns `el.href` for anchor elements, otherwise `el.click()` |

---

## 6) Invoke Contract

### Signature

```ts
ax.invoke(scope?, el, action, args?): AxInvokeResult
```

| Parameter | Required | Description |
|---|---|---|
| `scope` | no | Scope name or element. When omitted, inferred from element position. |
| `el` | yes | The target Element |
| `action` | yes | Capability: `"view"` | `"click"` | `"edit"` | `"nav"` | custom |
| `args` | no | Payload object passed to hook evaluation context |

### Overload resolution

- `invoke(el, "click")` — element + action (3 args or fewer)
- `invoke("scope", el, "click")` — explicit scope + element + action (4 args)

### Return Shape

```ts
type AxInvokeResult = {
  ok: boolean
  canceled?: boolean    // true if a before hook cancelled
  result?: any          // return value of the on hook
  error?: string        // error message if a hook threw or was cancelled with reason
}
```

### Examples

```js
// Read a view capability
const r1 = ax.invoke(el, "view", { item })
// → { ok: true, result: "29.99" }

// Trigger a click
const r2 = ax.invoke(el, "click")
// → { ok: true }

// Validation cancels with reason
// → { ok: false, canceled: true, error: "email is required" }
```

---

## 7) DOM Watch

AX can observe the DOM for mutations that affect annotated elements and keep the scan cache invalidated, so the client always reads fresh state.

```ts
ax.watch(callback?): MutationObserver   // start observing
ax.unwatch(): void                      // stop observing
```

### Setup

```js
import ax from "ax";

// Start watching — cache clears automatically when ax elements change
ax.watch();

// Or with a callback for notification
ax.watch((mutations) => {
    // ax cache already cleared — callback is informational
    console.log("ax-relevant DOM mutation detected", mutations.length);
});

// Stop watching
ax.unwatch();
```

### What the observer checks

The observer runs a single `MutationObserver` on `document.documentElement` with `childList: true, subtree: true, attributes: true` and no `attributeFilter`. Instead, it filters relevant mutations in the callback — this is intentional.

**For child list mutations** (elements added or removed), the callback walks the affected nodes one level deep checking for `ax-*` or `data-ax-*` attributes:

- Added node with `ax-click` → cache invalidated
- Added `<div>` (no ax attributes) → observer fires but ax skips it
- Removed `<form ax-ctx="signup">` → cache invalidated (parent check, ax children caught below)
- Added container with `<button ax-click="save">` as direct child → cache invalidated (one-level walk)
- Deeply nested ax element inside non-ax wrappers → cache invalidated if a direct child of the added/removed root has ax attributes

**For attribute mutations**, only `ax-*` and `data-ax-*` attribute names trigger invalidation. Framework-managed attributes (`class`, `style`, `aria-*`, `data-*` that don't start with `data-ax-`) are ignored.

### What this means for frameworks

Since there is no `attributeFilter`, the observer callback fires for *every* attribute change in the tree — including `class`, `style`, and any other DOM attribute managed by a reactive framework. The check inside the callback is a fast `startsWith("ax-") || startsWith("data-ax-")` test on the attribute name. Non-ax attribute changes return early without allocating or clearing cache.

This means:
- React/SolidJS class or style updates → observer callback fires → `isAXMutation` returns `false` → no cache invalidation
- Svelte/ Vue `data-*` attribute changes → same — only `data-ax-*` prefixed ones matter
- Custom primitives registered via `definePrimitive()` are automatically covered — no filter configuration needed

### Cache invalidation

When a relevant mutation is detected:

1. `lastScan` is set to `null`
2. `elementToId` (the element→id WeakMap) is replaced with a fresh WeakMap
3. If a callback was provided, it receives the raw `MutationRecord[]` array

The next `scan()` or `invoke()` call produces a fresh walk of the entire DOM.

### Flow example

```js
// Page renders: <span ax-view="order status" ax-click="editRow10234"
//                    ax-onClick="editRow10234">Shipped</span>

ax.watch();
let dag = ax.scan();
// dag.nodes: [{ id: "...", fn: [{ on: "view" }, { on: "click" }] }]

// Agent clicks — page swaps span for <select ax-edit="order status">
ax.invoke(el, "click");

// Observer fires: span removed (has ax-*), select added (has ax-edit)
// Cache cleared automatically

// Agent rescans — sees the edit capability
dag = ax.scan();
// dag.nodes: [{ id: "...", fn: [{ on: "edit", args: { "order status": "select?" } }] }]

ax.invoke(selectEl, "edit", { value: "Processing" });
```

### Important notes

- `watch()` creates a single `MutationObserver` that persists until `unwatch()` is called
- Calling `watch()` multiple times disconnects the previous observer and creates a new one
- The observer only cares about ax-relevant mutations — non-ax DOM changes are silently skipped
- It does not matter who caused the mutation (framework, extension, inline script) — the same check applies

---

## 8) Extensions (Core)

Extensions are first-class. They participate in both scan and invoke phases.

### Extension API

```ts
ax.defineExtension("name", {
  init(api) { ... }                             // receives { definePrimitive, getScan }
  onScanStart(ctx)    { ... }                   // root element, partial scan
  onNode(ctx)         { ... }                   // per-node during walk
  onScanEnd(ctx)      { ... }                   // complete scan
  beforeAction(ctx)   { ... }                   // before hook phase
  onInvoke(ctx)       { ... }                   // replaces default on-hook behavior
  afterAction(ctx)    { ... }                   // after hook phase
})
ax.removeExtension("name")
ax.definePrimitive(attr, def)  // register custom ax-* attribute
```

### Custom Primitives

Extensions can define new `ax-*` attributes:

```ts
ax.definePrimitive("ax-rate", { kind: "ext:rating" });
// Now <div ax-rate="thumbs up"> is a valid capability node
// with fn: [{ on: "ext:rating", name: "thumbs up" }]
```

---

## 9) ax.config

```ts
ax.config = {
  allowEval: false   // HTMX-style inline function evaluation
}
```

---

## 10) Minimal Public API

```ts
scan(root?: Element): AxScan
process(root?: Element): AxScan
invoke(scope?, el, action, args?): AxInvokeResult
watch(callback?): MutationObserver
unwatch(): void

defineExtension(name, ext): void
removeExtension(name): void
definePrimitive(attr, def): void

config: { allowEval: boolean }
```

---

## 11) Design Principle

If a feature does more than express/compile the DOM contract or execute lifecycle hooks the page promises, it belongs in extensions or the harness — not AX core.

No AX-* attribute should duplicate information already available from native HTML. The DOM is the contract — `required`, `type`, `minlength`, and other native attributes speak for themselves.
