# AX Context (Current)

AX has been reduced to a minimal core:

1. **DOM annotations are the contract** (`ax-view`, `ax-click`, `ax-edit`, `ax-nav`, `ax-ignore`)
2. **Fresh graph compilation** via `scan()` on demand
3. **Action lifecycle** with before/after interception
4. **Extensions are core** via `defineExtension()`

Removed from core:
- template pipeline
- `ax-for` routing
- attribute lifecycle hooks
- built-in status inference
- mutation smart-diff/cache invalidation machinery

The source of truth is now:
- `spec.md` (core requirements)
- `README.md` (developer-facing summary)
- `src/index.js` (minimal runtime)
