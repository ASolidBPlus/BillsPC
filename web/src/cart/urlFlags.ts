/**
 * S7b — URL-flag parser for cart-write HIL bisection levers.
 *
 * Per AMEND-S7b-3 / DECISION-6: `?cart-write-chunk=64` downgrades the
 * FlashgbxProtocol's per-page write size from the upstream-default 256
 * to the read-symmetric 64. Default (omitted or `=256`) keeps 256.
 *
 * Per AMEND-S7b-19 #2: `?cart-write-baud=1m` suppresses the 1.5M baud
 * upgrade for writes (writes happen at 1M instead). Default (omitted or
 * `=1.5m`) keeps 1.5M.
 *
 * The controller calls `parseUrlFlags(window.location.search)` at
 * createController-time and threads the resolved values into
 * `flashDeps.writeChunkBytes` / `flashDeps.writeBaud`. Tests inject a
 * synthetic search string and assert the parsed shape.
 *
 * Both flags are HIL bisection levers: they exist so a real-cart user
 * who hits a write-failure can A/B against a smaller chunk or a slower
 * baud without code edits. Keep this parser tiny and side-effect free
 * — it's pure: search-string in, options out.
 */

export interface ParsedUrlFlags {
  /** Per AMEND-S7b-3 / DECISION-6 — page-write size override. */
  readonly writeChunkBytes?: 64 | 256;
  /** Per AMEND-S7b-19 #2 — write-side baud override. */
  readonly writeBaud?: 1_000_000 | 1_500_000;
  /** S10 D1 — `?patch=1` opens the manual cart-patch workbench.
   *  Literal `'1'` only; any other value (`q`, `0`, `true`, …) is ignored. */
  readonly patch?: '1';
}

/**
 * Parse the cart-write HIL flags from a URL search string. Unknown
 * values are silently ignored (defaults apply downstream). Returns an
 * object containing only the keys that were explicitly set — callers
 * spread it onto `CartFlasherDeps` so `undefined` doesn't shadow the
 * dep defaults.
 */
export function parseUrlFlags(search: string): ParsedUrlFlags {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return {};
  }

  const result: {
    writeChunkBytes?: 64 | 256;
    writeBaud?: 1_000_000 | 1_500_000;
    patch?: '1';
  } = {};

  const chunk = params.get('cart-write-chunk');
  if (chunk === '64') result.writeChunkBytes = 64;
  else if (chunk === '256') result.writeChunkBytes = 256;

  const baud = params.get('cart-write-baud');
  if (baud === '1m' || baud === '1M') result.writeBaud = 1_000_000;
  else if (baud === '1.5m' || baud === '1.5M') result.writeBaud = 1_500_000;

  // S10 D1: only literal '1' enables patch mode; anything else ignored.
  const patch = params.get('patch');
  if (patch === '1') result.patch = '1';

  return result;
}
