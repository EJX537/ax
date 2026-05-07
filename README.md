# ax

A lightweight htmx-like library for enhanced HTML via declarative attributes.

**Single-file lib**, typed with **JSDoc**, built for the **browser**.

## Setup

```bash
bun install
```

## Development

```bash
bun run typecheck   # TypeScript strict check (no emit)
bun run dev         # watch mode (runs src/index.js directly)
```

## Build

```bash
bun run build       # produces dist/ax.js + dist/ax.min.js
```

Outputs:
- `dist/ax.js` — bundled, readable ESM (~0.5 KB)
- `dist/ax.min.js` — minified ESM (~260 B)
