/**
 * Pure reducer transitions. No DOM access — runs identically under
 * jsdom or node. Ordered as the user-visible flow:
 *   idle → parsing → loaded
 *                 ↘ parse_error → idle
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

function file(name: string, size = 32768): { name: string; size: number } {
  return { name, size };
}

describe('reducer transitions', () => {
  it('idle → parsing on file_selected', () => {
    const next = reducer(INITIAL_STATE, { type: 'file_selected', file: file('demo.sav') });
    expect(next.kind).toBe('parsing');
  });

  it('parsing → loaded on file_parsed', () => {
    const s1 = reducer(INITIAL_STATE, { type: 'file_selected', file: file('demo.sav') });
    const s2 = reducer(s1, { type: 'file_parsed', save: fakeSave, fileName: 'demo.sav' });
    expect(s2.kind).toBe('loaded');
  });

  it('parsing → parse_error on file_failed', () => {
    const s1 = reducer(INITIAL_STATE, { type: 'file_selected', file: file('bad.sav') });
    const err: SaveError = { kind: 'save_error', reason: 'UNRECOGNIZED_FORMAT', message: 'no' };
    const s2 = reducer(s1, { type: 'file_failed', error: err, fileName: 'bad.sav' });
    expect(s2.kind).toBe('parse_error');
  });

  it('reset returns to idle from any state', () => {
    const loaded: AppState = {
      kind: 'loaded',
      fileName: 'x',
      save: fakeSave,
      results: new Map(),
      expandedBoxes: new Set(),
      currentBoxExpanded: false,
    };
    expect(reducer(loaded, { type: 'reset' }).kind).toBe('idle');
    expect(reducer(INITIAL_STATE, { type: 'reset' }).kind).toBe('idle');
  });

  it('convert_done is no-op when not loaded', () => {
    const ref: MonRef = { bucket: 'party', slot: 0 };
    const result: ConvertResult = { ok: false, reason: 'X', message: 'm' };
    const s = reducer(INITIAL_STATE, { type: 'convert_done', ref, result });
    expect(s).toBe(INITIAL_STATE);
  });

  it('convert_done overwrites previous result for same ref', () => {
    const loaded: AppState = {
      kind: 'loaded',
      fileName: 'x',
      save: fakeSave,
      results: new Map(),
      expandedBoxes: new Set(),
      currentBoxExpanded: false,
    };
    const ref: MonRef = { bucket: 'party', slot: 0 };
    const r1: ConvertResult = { ok: false, reason: 'A', message: 'a' };
    const r2: ConvertResult = { ok: false, reason: 'B', message: 'b' };
    const s1 = reducer(loaded, { type: 'convert_done', ref, result: r1 });
    const s2 = reducer(s1, { type: 'convert_done', ref, result: r2 });
    if (s2.kind !== 'loaded') throw new Error('expected loaded');
    expect(s2.results.get(monRefKey(ref))).toBe(r2);
    expect(s2.results.size).toBe(1);
  });

  it('box_toggled toggles a box index', () => {
    const loaded: AppState = {
      kind: 'loaded',
      fileName: 'x',
      save: fakeSave,
      results: new Map(),
      expandedBoxes: new Set(),
      currentBoxExpanded: false,
    };
    const s1 = reducer(loaded, { type: 'box_toggled', boxIndex: 3 });
    if (s1.kind !== 'loaded') throw new Error('expected loaded');
    expect(s1.expandedBoxes.has(3)).toBe(true);
    const s2 = reducer(s1, { type: 'box_toggled', boxIndex: 3 });
    if (s2.kind !== 'loaded') throw new Error('expected loaded');
    expect(s2.expandedBoxes.has(3)).toBe(false);
  });

  it('current_box_toggled flips currentBoxExpanded', () => {
    const loaded: AppState = {
      kind: 'loaded',
      fileName: 'x',
      save: fakeSave,
      results: new Map(),
      expandedBoxes: new Set(),
      currentBoxExpanded: false,
    };
    const s1 = reducer(loaded, { type: 'current_box_toggled' });
    if (s1.kind !== 'loaded') throw new Error('expected loaded');
    expect(s1.currentBoxExpanded).toBe(true);
  });

  it('reducer is pure: same input → equal-shaped output, no aliasing of nested maps', () => {
    const loaded: AppState = {
      kind: 'loaded',
      fileName: 'x',
      save: fakeSave,
      results: new Map(),
      expandedBoxes: new Set(),
      currentBoxExpanded: false,
    };
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
