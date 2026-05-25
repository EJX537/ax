# ax

AX is a semantic annotation layer where the DOM is the contract between a webpage and an agent interface.

## What it does

1. **Scans** annotated HTML (`ax-view`, `ax-click`, `ax-edit`, `ax-nav`) and compiles it into a traversable DAG (`{ dag, nodes }`)
2. **Invokes** capabilities with a before/on/after lifecycle — `ax-on*` hooks are the page's promise, evaluated HTMX-style — returns `{ ok, canceled, result, error }`
3. **Watches** for DOM mutations that invalidate the scan cache, so the agent always reads fresh state
4. **Extends** via first-class extension hooks that participate in scan and invoke

## Primitives

| Attribute | Capability | Purpose |
|---|---|---|
| `ax-view` | view | Readable content region |
| `ax-click` | click | Triggerable action |
| `ax-edit` | edit | Writable field — args derived from native HTML |
| `ax-nav` | nav | Navigation action |
| `ax-ctx` | — | Scope boundary |
| `ax-ignore` | — | Exclude subtree from AX |

Each primitive requires a non-empty name. Hooks use camelCase — `ax-onClick`, `ax-beforeClick`, `ax-afterClick` (or `data-ax-onClick` etc.).

```html
<main ax-ctx="app">
  <span ax-view="order status" ax-click="editRow10234" ax-onClick="editRow10234">Shipped</span>
  <button ax-click="buy" ax-onClick="(ctx) => purchase(ctx.args.item)">Buy</button>
</main>
```

## API

```js
ax.scan(root?)                         // compile DOM → { dag, nodes }
ax.invoke(scope?, el, action, args?)   // trigger capability lifecycle
ax.watch(callback?)                    // observe DOM mutations, invalidate cache
ax.unwatch()                           // stop observing

ax.defineExtension(name, ext)          // register extension
ax.removeExtension(name)               // unregister
ax.definePrimitive(attr, def)          // register custom ax-* attribute
```

## Invoke result

```js
const r = ax.invoke(el, "click");
// → { ok: true, result: "bought" }
// → { ok: false, canceled: true, error: "validation failed" }
```

## Design Principle

If a feature does more than express/compile the DOM contract or execute lifecycle hooks the page promises, it belongs in extensions or the harness — not AX core.

## Development

```bash
bun install
bun test
bun run typecheck
```
