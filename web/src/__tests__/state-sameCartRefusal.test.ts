/**
 * S7b — same-cart hard-refuse reducer tests (Gap 2 from EVAL.md
 * "Headline gaps", per AMEND-S7b-16 / DECISION-2).
 *
 * The reducer surfaces a `state.sameCartRefusal` flag when the dest-
 * connect path detects (tid, label) match with the source cart. The
 * controller (`web/src/ui.ts handleCartConnect`) is responsible for
 * the actual compare; the reducer just stores the flag and the UI
 * renders the modal.
 *
 * Per DECISION-2: hard-refuse with NO OVERRIDE escape hatch. The only
 * way to clear the flag is `same_cart_refusal_dismissed` (the modal's
 * "OK" button), and the controller blocks any subsequent `commit_started`
 * while the flag is set.
 */

import { describe, it, expect } from 'vitest';
import { INITIAL_STATE, reducer, type AppState } from '../state.js';

describe('same-cart refusal reducer (AMEND-S7b-16 / DECISION-2)', () => {
  it('same_cart_refused sets state.sameCartRefusal with sourceTid + sourceLabel', () => {
    const state = reducer(INITIAL_STATE, {
      type: 'same_cart_refused',
      sourceTid: 12345,
      sourceLabel: 'POKEMON RUBY',
    });
    expect(state.sameCartRefusal).toEqual({
      sourceTid: 12345,
      sourceLabel: 'POKEMON RUBY',
    });
  });

  it('same_cart_refused clears any in-flight cartReadProgress so the dest pane stops spinning', () => {
    let state: AppState = reducer(INITIAL_STATE, { type: 'cart_connect_started', side: 'dest' });
    expect(state.cartReadProgress).toBeDefined();
    state = reducer(state, {
      type: 'same_cart_refused',
      sourceTid: 12345,
      sourceLabel: 'POKEMON RUBY',
    });
    expect(state.cartReadProgress).toBeUndefined();
    expect(state.sameCartRefusal).toBeDefined();
  });

  it('same_cart_refusal_dismissed clears the flag', () => {
    let state: AppState = reducer(INITIAL_STATE, {
      type: 'same_cart_refused',
      sourceTid: 12345,
      sourceLabel: 'POKEMON RUBY',
    });
    expect(state.sameCartRefusal).toBeDefined();
    state = reducer(state, { type: 'same_cart_refusal_dismissed' });
    expect(state.sameCartRefusal).toBeUndefined();
  });

  it('same_cart_refusal_dismissed is a no-op when no refusal is set', () => {
    const state = reducer(INITIAL_STATE, { type: 'same_cart_refusal_dismissed' });
    expect(state.sameCartRefusal).toBeUndefined();
    // Identity preservation: returning `state` (no copy) when nothing
    // to clear is a small perf nicety — and proves we haven't created
    // a spurious refusal.
    expect(state).toBe(INITIAL_STATE);
  });

  it('refusal flag is independent of cartFlash sub-state', () => {
    let state: AppState = reducer(INITIAL_STATE, {
      type: 'same_cart_refused',
      sourceTid: 9999,
      sourceLabel: 'POKEMON CRYSTAL',
    });
    state = reducer(state, {
      type: 'commit_started',
      target: 'destination',
      planSummary: 'x',
    });
    // The reducer doesn't gate on the refusal flag (the controller does);
    // confirm the state still carries both pieces of info so the UI can
    // render the refusal modal AND the (blocked) confirm dialog.
    expect(state.sameCartRefusal).toBeDefined();
    expect(state.cartFlash?.kind).toBe('cart_flash_pending');
  });
});
