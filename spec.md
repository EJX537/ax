# AX Core Specification

## Definition

**AX is a semantic annotation layer where the DOM is the contract between a webpage and an agent interface.**

AX is not an agent runtime. It does not make decisions. It compiles annotated DOM into a client-usable model and executes lifecycle hooks that the page promises to the client.

---

## 1) Core Goals

1. **DOM Contract**: `ax-*` attributes are the source of truth
2. **Element-Centric Compilation**: one element with multiple capabilities, not one node per primitive
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
| edit | `ax-edit` | writable field/action |
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

### Scoping

- `<html>` is the implicit root scope
- `ax-ctx` creates a named scope boundary
- Capabilities propagate within scope unless overridden by an inner `ax-ctx` or `ax-ignore`
- `ax-ignore` excludes the element and all descendants from the AX contract

---

## 3) Compilation Model

### Scan Contract

`ax.scan(root?)` walks the DOM and returns a scope-indexed snapshot.

- No parentId / childIds in the output
- No smart-diff requirement
- Fresh rebuild on each call

### Output Shape

```ts
type AxScan = {
  version: number
  generatedAt: number
  /** Scope index. "<html>" is the implicit root. */
  contexts: Record<string, AxContext>
}

type AxContext = {
  name: string
  nodes: AxNode[]
}

type AxNode = {
  /** Identity — uses el.id if present, otherwise AX assigns an ephemeral key for the snapshot lifetime. No strict id contract. */
  key: string
  /** Runtime pointer. Non-serializable. */
  el: Element
  tag: string
  /** ax-* attributes present on the element (all, for client inspection) */
  attrs: Record<string, string>
  /** Capabilities this element exposes (one entry per ax-* primitive present) */
  capabilities: Record<string, AxCapability>
}

type AxCapability = {
  kind: "view" | "click" | "edit" | "nav" | string
  name: string
  href?: string      // nav only
  inputType?: string // edit only
  text?: string      // view / click / nav
  value?: string | boolean  // edit only
  hooks: {
    before?: string  // raw eval string
    on?: string      // raw eval string
    after?: string   // raw eval string
  }
}
```

### Element-Centric, Not Primitive-Centric

A single element with both `ax-view` and `ax-click` produces one node with two capabilities:

```html
<div ax-view="price" ax-onView="() => item.price" ax-click="buy Widget">Widget</div>
```

Compiles to:

```json
{
  "key": "price-card",
  "el": ...,
  "tag": "div",
  "attrs": {
    "ax-view": "price",
    "ax-onView": "() => item.price",
    "ax-click": "buy Widget"
  },
  "capabilities": {
    "view": {
      "kind": "view",
      "name": "price",
      "text": "Widget",
      "hooks": { "on": "() => item.price" }
    },
    "click": {
      "kind": "click",
      "name": "buy Widget",
      "text": "Widget",
      "hooks": {}
    }
  }
}
```

The client reads the same element differently depending on interaction mode:

- **Read mode**: use `capabilities.view` to get content name + hook promise
- **Act mode**: use `capabilities.click` to invoke the action

---

## 4) Hook Lifecycle (HTMX-style eval)

`ax-on*` attributes are the **page's promise** to the client. When invoked, AX evaluates them using HTMX-style eval (controlled by `ax.config.allowEval`, defaults to `true`).

### Hook Attribute Mapping

| Short attribute | Maps to capability hook |
|---|---|
| `ax-on-view` | view.on |
| `ax-before-view` | view.before |
| `ax-after-view` | view.after |
| `ax-on-click` | click.on |
| `ax-before-click` | click.before |
| `ax-after-click` | click.after |
| `ax-on-edit` | edit.on |
| `ax-before-edit` | edit.before |
| `ax-after-edit` | edit.after |
| `ax-on-nav` | nav.on |
| `ax-before-nav` | nav.before |
| `ax-after-nav` | nav.after |

(Kebab-cased attribute names. Must be on the same element as the corresponding primitive.)

### Hook Execution Order

```
before hook   →   (cancel early if false returned)
on hook       →   (primary behavior)
after hook    →   (post-processing)
```

- `before` — guard/cancel/inspect. If returns `false` or throws `CancelError`, the chain stops.
- `on` — primary action implementation. The value it returns becomes the result.
- `after` — post-action. Result is the `on` return value (or `undefined` if cancelled).

### Eval Context

Each hook function receives:

```ts
{ el, action: string, args: any, scope: string, ax: AxAPI }
```

Example:

```html
<div ax-view="price" ax-on-view="(ctx) => ctx.args.item.price"></div>
```

When client calls `ax.invoke(el, "view", { item })`, the `on` hook evaluates to `item.price`.

### allowEval Control

```ts
// default: true (HTMX-like)
ax.config = { allowEval: true }

// When false, inline hook strings throw or are silently skipped
```

---

## 5) Invoke Contract

The primary runtime interaction API.

### Signature

```ts
ax.invoke(scope?, el, action, args?): AxInvokeResult
```

| Parameter | Required | Description |
|---|---|---|
| `scope` | no | Scope name (string) or element. Defaults to global root context. |
| `el` | yes | The target Element |
| `action` | yes | Capability name: `"view"` | `"click"` | `"edit"` | `"nav"` | custom |
| `args` | no | Payload object passed to hook evaluation context |

### Behavior

1. **Resolve scope**:
   - Omitted → global root (`<html>` context)
   - Provided → validate element belongs to that scope

2. **Validate**:
   - Element is not under `ax-ignore`
   - Element has the requested capability

3. **Run lifecycle**:

```
1. Run extension.beforeAction(ctx)
2. Run ax-before-<action> hook on element
3. Run ax-on-<action> hook on element
4. Run ax-after-<action> hook on element
5. Run extension.afterAction(ctx)
```

Each step can cancel by returning `false` or throwing.

### Return Shape

```ts
type AxInvokeResult = {
  ok: boolean
  canceled?: boolean    // true if a before hook cancelled
  result?: any          // return value of the on hook
  error?: string        // error message if hook threw
}
```

### Examples

```js
// Read a view capability
const r1 = ax.invoke(el, "view", { item })
// → { ok: true, result: 29.99 }

// Trigger a click
const r2 = ax.invoke(el, "click", { item })
// → { ok: true, result: "bought Widget" }

// Scope-aware
const r3 = ax.invoke("sidebar", el, "nav", {})
// → { ok: true, result: "/next" }
```

---

## 6) Invocation without eval (dry contract)

If a page has `ax-view="price"` but no `ax-on-view` hook, invocation returns the element state directly:

```js
ax.invoke(el, "view", {})
// → { ok: true, result: el.textContent?.trim() ?? "" }
```

AX provides sensible default behavior for each capability when no `on` hook is defined:

| Capability | Default |
|---|---|
| view | `el.textContent?.trim()` |
| click | `el.click()` (native DOM) |
| edit | `el.value` (or `.checked` for checkbox/radio) |
| nav | `el.href` or `el.click()` |

---

## 7) Extensions (Core)

Extensions are first-class. They participate in both scan and invoke phases.

### Extension API

```ts
ax.defineExtension("name", {
  init(api) { ... }
  onScanStart(ctx) { ... }
  onNode(ctx) { ... }
  onScanEnd(ctx) { ... }
  beforeAction(ctx) { ... }
  afterAction(ctx) { ... }
  onInvoke(ctx) { ... }      // replaces default on-hook behavior
})
ax.removeExtension("name")
ax.definePrimitive(attr, def) // register custom ax-* attribute
```

---

## 8) ax.config

```ts
ax.config = {
  allowEval: true   // HTMX-style inline function evaluation
}
```

---

## 9) Explicit Non-Core Features

The following belong in extensions or harnesses, not AX core:

1. Template pipeline / transform DAG
2. `ax-for` routing
3. Built-in status inference engine
4. Smart DOM diff / patch protocol
5. Strict id semantics for serialization

---

## 10) Minimal Public API

```ts
scan(root?: Element): AxScan
process(root?: Element): AxScan
invoke(scope?, el, action, args?): AxInvokeResult

defineExtension(name, ext): void
removeExtension(name): void
definePrimitive(attr, def): void

config: { allowEval: boolean }
```

---

## 11) Design Principle

If a feature does more than express/compile the DOM contract or execute lifecycle hooks the page promises, it belongs in extensions or the harness — not AX core.
