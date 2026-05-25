# ax

A semantic annotation layer: the DOM is the contract between a webpage and an agent interface.

## What it does

**ax** walks annotated HTML and compiles it into a tree-based DAG an agent can traverse. It executes lifecycle hooks the page promises, returns structured results, and stays out of the way.

```html
<main>
  <span ax-view="order status" ax-click="editRow10234"
        ax-onClick="editRow10234">Shipped</span>
  <button ax-click="buy" ax-onClick="(ctx) => purchase(ctx.args.item)">Buy</button>
</main>
```

```
scan        →  { dag: { id → childIds }, nodes: [{ id, parent, children, fn }] }
invoke      →  { ok, canceled?, result?, error? }
watch       →  invalidates cache on DOM mutation
extensions  →  hooks into scan & invoke lifecycle
```

## Quick start

```js
import ax from "ax";

const { dag, nodes } = ax.scan();
// dag:  { "root": ["btn"], "btn": [] }
// nodes:[{ id: "btn", fn: [{ on: "click", name: "buy" }] }]

const r = ax.invoke(btn, "click");
// → { ok: true, result: "purchased" }
```

## Primitives

| Attribute        | Capability | Description                             |
|------------------|------------|-----------------------------------------|
| `ax-view`        | view       | readable content region                 |
| `ax-click`       | click      | triggerable action                      |
| `ax-edit`        | edit       | writable field — args from native HTML  |
| `ax-nav`         | nav        | navigation action                       |
| `ax-ctx`         | —          | scope boundary                          |
| `ax-ignore`      | —          | exclude subtree from ax                 |

Hook attributes use camelCase after the phase word: `ax-onClick`, `ax-beforeClick`, `ax-afterClick`.  
All `ax-*` attributes also accept the `data-ax-*` prefix.

## API

```js
ax.scan(root?)                         // compile DOM → AxScan
ax.invoke(scope?, el, action, args?)   // trigger capability lifecycle
ax.watch(callback?)                    // observe DOM mutations
ax.unwatch()                           // stop observing

ax.defineExtension(name, ext)          // register extension
ax.removeExtension(name)               // unregister
ax.definePrimitive(attr, def)          // register custom ax-* attribute
```

## Design

If a feature does more than express/compile the DOM contract or execute lifecycle hooks the page promises, it belongs in extensions or the harness — not ax core.

The DOM is the contract. ax never duplicates information already available from native HTML (`required`, `type`, `minlength`, etc.).

## Development

```bash
bun install
bun test
bun run typecheck
bun run generate      # regenerate golden test files
bun run build         # produces dist/ax.js, dist/ax.min.js
```

## Docs

Full specification in [`docs/spec.md`](docs/spec.md).
