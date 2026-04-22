/**
 * Pure reducer transitions. No DOM access — runs identically under
 * jsdom or node.
 *
 * Per PLAN_EVAL S5 A9, the dead `expandedBoxes`, `currentBoxExpanded`
 * fields and `box_toggled` / `current_box_toggled` actions are removed
 * outright. The new S5 actions are `cursor_move`, `box_change`,
 * `mon_open`, `mon_close`.
 */
import { describe, it, expect } from 'vitest';
import {
  reducer,
  INITIAL_STATE,
  monRefKey,
  type Action,
  type AppState,
  type ConvertResult,
  type MonRef,
} from '../state.js';
import type { SaveContents, SaveError } from '@pokeportal/core';

const fakeSave: SaveContents = {
  format: 'CRYSTAL',
  trainer: { name: 'TEST', nameBytes: new Uint8Array(11), tid: 1234 },
  party: [],
  boxes: Array.from({ length: 14 }, () => []),
  warnings: [],
};

function makeLoaded(): Extract<AppState, { kind: 'loaded' }> {
  return {
    kind: 'loaded',
    fileName: 'x',
    save: fakeSave,
    results: new Map(),
    boxIndex: 0,
    cursor: { row: 0, col: 0 },
    openMon: null,
  };
}

function file(name: string, size = 32768): { name: string; size: number } {
  return { name, size };
}

describe('reducer transitions', () => {
  it('idle → parsing on file_selected', () => {
    const next = reducer(INITIAL_STATE, { type: 'file_selected', file: file('demo.sav') });
    expect(next.kind).toBe('parsing');
  });

  it('parsing → loaded on file_parsed populates S5 defaults', () => {
    const s1 = reducer(INITIAL_STATE, { type: 'file_selected', file: file('demo.sav') });
    const s2 = reducer(s1, { type: 'file_parsed', save: fakeSave, fileName: 'demo.sav' });
    expect(s2.kind).toBe('loaded');
    if (s2.kind !== 'loaded') return;
    expect(s2.boxIndex).toBe(0);
    expect(s2.cursor).toEqual({ row: 0, col: 0 });
    expect(s2.openMon).toBeNull();
  });

  it('parsing → parse_error on file_failed', () => {
    const s1 = reducer(INITIAL_STATE, { type: 'file_selected', file: file('bad.sav') });
    const err: SaveError = { kind: 'save_error', reason: 'UNRECOGNIZED_FORMAT', message: 'no' };
    const s2 = reducer(s1, { type: 'file_failed', error: err, fileName: 'bad.sav' });
    expect(s2.kind).toBe('parse_error');
  });

  it('reset returns to idle from any state', () => {
    expect(reducer(makeLoaded(), { type: 'reset' }).kind).toBe('idle');
    expect(reducer(INITIAL_STATE, { type: 'reset' }).kind).toBe('idle');
  });

  it('convert_done is no-op when not loaded', () => {
    const ref: MonRef = { bucket: 'party', slot: 0 };
    const result: ConvertResult = { ok: false, reason: 'X', message: 'm' };
    const s = reducer(INITIAL_STATE, { type: 'convert_done', ref, result });
    expect(s).toBe(INITIAL_STATE);
  });

  it('convert_done overwrites previous result for same ref', () => {
    const loaded = makeLoaded();
    const ref: MonRef = { bucket: 'party', slot: 0 };
    const r1: ConvertResult = { ok: false, reason: 'A', message: 'a' };
    const r2: ConvertResult = { ok: false, reason: 'B', message: 'b' };
    const s1 = reducer(loaded, { type: 'convert_done', ref, result: r1 });
    const s2 = reducer(s1, { type: 'convert_done', ref, result: r2 });
    if (s2.kind !== 'loaded') throw new Error('expected loaded');
    expect(s2.results.get(monRefKey(ref))).toBe(r2);
    expect(s2.results.size).toBe(1);
  });

  it('cursor_move clamps within the 5×4 grid', () => {
    const loaded = makeLoaded();
    let s: AppState = loaded;
    s = reducer(s, { type: 'cursor_move', drow: -1, dcol: -1 });
    if (s.kind !== 'loaded') throw new Error('expected loaded');
    expect(s.cursor).toEqual({ row: 0, col: 0 }); // clamped
    s = reducer(s, { type: 'cursor_move', drow: 1, dcol: 1 });
    if (s.kind !== 'loaded') throw new Error('expected loaded');
    expect(s.cursor).toEqual({ row: 1, col: 1 });
    // 4 more right moves — clamps at col=3.
    for (let i = 0; i < 5; i++) s = reducer(s, { type: 'cursor_move', drow: 0, dcol: 1 });
    if (s.kind !== 'loaded') throw new Error('expected loaded');
    expect(s.cursor.col).toBe(3);
  });

  it('cursor_move returns the same state on a no-op move', () => {
    const loaded = makeLoaded();
    const s = reducer(loaded, { type: 'cursor_move', drow: -1, dcol: -1 });
    expect(s).toBe(loaded);
  });

  it('box_change increments boxIndex and resets cursor', () => {
    let s: AppState = makeLoaded();
    s = reducer(s, { type: 'cursor_move', drow: 1, dcol: 1 });
    s = reducer(s, { type: 'cursor_move', drow: 1, dcol: 1 });
    s = reducer(s, { type: 'box_change', delta: 1 });
    if (s.kind !== 'loaded') throw new Error('expected loaded');
    expect(s.boxIndex).toBe(1);
    expect(s.cursor).toEqual({ row: 0, col: 0 });
  });

  it('box_change clamps at 0 on the low end', () => {
    const loaded = makeLoaded();
    const s = reducer(loaded, { type: 'box_change', delta: -1 });
    expect(s).toBe(loaded);
  });

  it('box_change clamps at the upper bound', () => {
    let s: AppState = makeLoaded();
    // 0 (party) + 14 (boxes) = max valid index 14, no current box.
    for (let i = 0; i < 25; i++) s = reducer(s, { type: 'box_change', delta: 1 });
    if (s.kind !== 'loaded') throw new Error('expected loaded');
    expect(s.boxIndex).toBe(14);
  });

  it('mon_open / mon_close set and clear openMon', () => {
    const loaded = makeLoaded();
    const ref: MonRef = { bucket: 'party', slot: 0 };
    const s1 = reducer(loaded, { type: 'mon_open', ref });
    if (s1.kind !== 'loaded') throw new Error('expected loaded');
    expect(s1.openMon).toEqual(ref);
    const s2 = reducer(s1, { type: 'mon_close' });
    if (s2.kind !== 'loaded') throw new Error('expected loaded');
    expect(s2.openMon).toBeNull();
  });

  it('S5 actions are no-ops outside loaded', () => {
    const ref: MonRef = { bucket: 'party', slot: 0 };
    expect(reducer(INITIAL_STATE, { type: 'cursor_move', drow: 1, dcol: 0 })).toBe(INITIAL_STATE);
    expect(reducer(INITIAL_STATE, { type: 'box_change', delta: 1 })).toBe(INITIAL_STATE);
    expect(reducer(INITIAL_STATE, { type: 'mon_open', ref })).toBe(INITIAL_STATE);
    expect(reducer(INITIAL_STATE, { type: 'mon_close' })).toBe(INITIAL_STATE);
  });

  it('reducer is pure: same input → equal-shaped output, no aliasing of nested maps', () => {
    const loaded = makeLoaded();
    const ref: MonRef = { bucket: 'box', boxIndex: 0, slot: 1 };
    const r: ConvertResult = { ok: false, reason: 'X', message: 'x' };
    const action: Action = { type: 'convert_done', ref, result: r };
    const s1 = reducer(loaded, action);
    const s2 = reducer(loaded, action);
    expect(s1).not.toBe(s2);
    if (s1.kind !== 'loaded' || s2.kind !== 'loaded') throw new Error('expected loaded');
    expect(s1.results).not.toBe(s2.results);
  });
});

describe('monRefKey', () => {
  it('produces distinct keys for party / currentBox / box buckets', () => {
    const k1 = monRefKey({ bucket: 'party', slot: 0 });
    const k2 = monRefKey({ bucket: 'currentBox', slot: 0 });
    const k3 = monRefKey({ bucket: 'box', boxIndex: 0, slot: 0 });
    expect(new Set([k1, k2, k3]).size).toBe(3);
  });

  it('different boxIndex on box bucket → different key', () => {
    const a = monRefKey({ bucket: 'box', boxIndex: 0, slot: 0 });
    const b = monRefKey({ bucket: 'box', boxIndex: 1, slot: 0 });
    expect(a).not.toBe(b);
  });
});
