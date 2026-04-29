/**
 * S10 Stage 1 — `?patch=1` URL flag → reducer dispatch.
 *
 * Verifies the literal `'1'` semantics (D1) and that the patch flag
 * coexists with `?ui=v1` (independent flags).
 */

import { describe, it, expect } from 'vitest';
import { parseUrlFlags } from '../cart/urlFlags.js';
import { reducer, INITIAL_STATE, type Action } from '../state.js';

describe('parseUrlFlags — patch flag (S10 D1)', () => {
  it('?patch=1 → patch: "1"', () => {
    expect(parseUrlFlags('?patch=1')).toEqual({ patch: '1' });
  });

  it('?patch=q → ignored (literal "1" only)', () => {
    expect(parseUrlFlags('?patch=q')).toEqual({});
  });

  it('?patch=0 → ignored', () => {
    expect(parseUrlFlags('?patch=0')).toEqual({});
  });

  it('?patch=true → ignored', () => {
    expect(parseUrlFlags('?patch=true')).toEqual({});
  });

  it('absent → patch omitted', () => {
    expect(parseUrlFlags('')).toEqual({});
  });

  it('?ui=v1&patch=1 → patch: "1" (other flags untouched)', () => {
    // parseUrlFlags doesn't parse `ui` (that lives in `hasLegacyV1Flag`),
    // so we just assert patch survives alongside an unrelated flag.
    expect(parseUrlFlags('?ui=v1&patch=1')).toEqual({ patch: '1' });
  });

  it('?cart-write-chunk=64&patch=1 → both flags honoured independently', () => {
    expect(parseUrlFlags('?cart-write-chunk=64&patch=1')).toEqual({
      writeChunkBytes: 64,
      patch: '1',
    });
  });
});

describe('patch_mode_enabled reducer', () => {
  it('flips patchMode to true and seeds an empty session', () => {
    const next = reducer(INITIAL_STATE, { type: 'patch_mode_enabled' });
    expect(next.patchMode).toBe(true);
    expect(next.patchSession).toBeDefined();
    expect(next.patchSession?.source).toBeNull();
    expect(next.patchSession?.dest).toBeNull();
    expect(next.patchSession?.pendingEdits.size).toBe(0);
  });

  it('is idempotent', () => {
    const a = reducer(INITIAL_STATE, { type: 'patch_mode_enabled' });
    const b = reducer(a, { type: 'patch_mode_enabled' });
    expect(b).toBe(a);
  });

  it('default state has patchMode unset (byte-identical baseline)', () => {
    expect(INITIAL_STATE.patchMode).toBeUndefined();
    expect(INITIAL_STATE.patchSession).toBeUndefined();
  });
});

describe('patch_*_loaded actions gate on patchMode', () => {
  const fakeSave = { trainer: { name: 'X', tid: 1 }, party: [], boxes: [] } as never;
  const fakeGen3 = {
    trainer: { name: 'Y', tid: 2 },
    pc: { boxes: [] },
  } as never;

  it('patch_source_loaded ignored when patchMode === false', () => {
    const next = reducer(INITIAL_STATE, {
      type: 'patch_source_loaded',
      save: fakeSave,
      cartLabel: 'cart',
    });
    expect(next.patchSession).toBeUndefined();
  });

  it('patch_source_loaded accepted when patchMode === true', () => {
    const enabled = reducer(INITIAL_STATE, { type: 'patch_mode_enabled' });
    const next = reducer(enabled, {
      type: 'patch_source_loaded',
      save: fakeSave,
      cartLabel: 'cart-A',
    });
    expect(next.patchSession?.source?.cartLabel).toBe('cart-A');
  });

  it('patch_dest_loaded accepted when patchMode === true', () => {
    const enabled = reducer(INITIAL_STATE, { type: 'patch_mode_enabled' });
    const next = reducer(enabled, {
      type: 'patch_dest_loaded',
      save: fakeGen3,
      cartLabel: 'gba-cart',
    });
    expect(next.patchSession?.dest?.cartLabel).toBe('gba-cart');
  });

  it('patch_edit_applied requires dest', () => {
    const enabled = reducer(INITIAL_STATE, { type: 'patch_mode_enabled' });
    const next = reducer(enabled, {
      type: 'patch_edit_applied',
      boxIndex: 0,
      slot: 0,
      edits: { pid: 0xdeadbeef },
    } as Action);
    expect(next.patchSession?.pendingEdits.size).toBe(0);
  });

  it('patch_edit_applied stages edits keyed by box:slot once dest loaded', () => {
    let s = reducer(INITIAL_STATE, { type: 'patch_mode_enabled' });
    s = reducer(s, { type: 'patch_dest_loaded', save: fakeGen3, cartLabel: 'gba' });
    s = reducer(s, {
      type: 'patch_edit_applied',
      boxIndex: 2,
      slot: 4,
      edits: { pid: 0x12345678 },
    });
    expect(s.patchSession?.pendingEdits.size).toBe(1);
    expect(s.patchSession?.pendingEdits.get('2:4')?.pid).toBe(0x12345678);
  });

  it('patch_session_cleared empties pendingEdits', () => {
    let s = reducer(INITIAL_STATE, { type: 'patch_mode_enabled' });
    s = reducer(s, { type: 'patch_dest_loaded', save: fakeGen3, cartLabel: 'gba' });
    s = reducer(s, {
      type: 'patch_edit_applied',
      boxIndex: 0,
      slot: 0,
      edits: { tid: 7 },
    });
    s = reducer(s, { type: 'patch_session_cleared' });
    expect(s.patchSession?.pendingEdits.size).toBe(0);
  });
});
