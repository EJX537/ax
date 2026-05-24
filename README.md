# ax

AX is a semantic annotation layer where the DOM is the contract between a webpage and an agent interface.

## What it does

1. **Scans** annotated HTML (`ax-view`, `ax-click`, `ax-edit`, `ax-nav`) and compiles it into an element-centric scope model
2. **Invokes** capabilities with a before/on/after lifecycle — `ax-on*` hooks are the page's promise, evaluated HTMX-style
3. **Extends** via first-class extension hooks

## Primitives

| Attribute | Capability | Purpose |
|---|---|---|
| `ax-view` | view | Readable content region |
| `ax-click` | click | Triggerable action |
| `ax-edit` | edit | Writable field/action |
| `ax-nav` | nav | Navigation action |
| `ax-ctx` | — | Scope boundary |
| `ax-ignore` | — | Exclude subtree from AX |

Each primitive requires a non-empty name. Hooks (`ax-on-view`, `ax-before-click`, etc.) are the page's promise.

```html
<main ax-ctx="app">
  <div ax-view="price" ax-on-view="(ctx) => ctx.args.price">$29.99</div>
  <button ax-click="buy" ax-on-click="(ctx) => purchase(ctx.args.item)">Buy</button>
</main>
```

## API

```js
ax.scan(root?)                        // compile DOM → scope model
ax.invoke(scope?, el, action, args?)  // trigger capability lifecycle

ax.defineExtension(name, ext)          // register extension
ax.removeExtension(name)               // unregister
ax.definePrimitive(attr, def)          // register custom ax-* attribute
```

## Development

```bash
bun install
bun test
bun run typecheck
```
