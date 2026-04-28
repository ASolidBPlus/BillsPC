/**
 * vitest setup file: set the URL to `?ui=v1` so the legacy `render()` path
 * runs by default in tests. v2 is the production default; the existing
 * test suite predates v2 and asserts on legacy DOM elements (comparison
 * overlay, upload dropzone, etc.). Tests that exercise v2 don't go
 * through `render()` — they construct the workbench directly via
 * `renderWorkbench(props)` from `web/src/ui/workbench.ts` — so this flag
 * is invisible to them.
 *
 * Wired via `vitest.config.ts` `setupFiles`.
 */
if (typeof window !== 'undefined' && window.history) {
  window.history.replaceState({}, '', '?ui=v1');
}
