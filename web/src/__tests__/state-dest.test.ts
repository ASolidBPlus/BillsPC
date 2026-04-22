/**
 * S6a — Reducer transitions for the destination flow.
 *
 * Pure reducer tests; no DOM. Verifies the additive `loaded` extension
 * does not regress any S5 behaviour.
 */
import { describe, it, expect } from 'vitest';
import { reducer, INITIAL_STATE, destCursorToSlot, type AppState } from '../state.js';
import type { Gen3SaveContents, SaveContents, SaveError } from '@pokeportal/core';

const fakeSave: SaveContents = {
  format: 'CRYSTAL',
  trainer: { name: 'TEST', nameBytes: new Uint8Array(11), tid: 1234 },
  party: [],
  boxes: Array.from({ length: 14 }, () => []),
  warnings: [],
};

function makeFakeGen3(): Gen3SaveContents {
  // Minimum fake; reducer never inspects the inner shape beyond its
  // existence + the `pc.boxes[..][..]` lookup used by the
  // destStore-build path (which is in ui.ts, not the reducer).
  return {
    kind: 'gen3_save',
    format: 'EMERALD',
    family: 'EMERALD',
    bytes: new Uint8Array(131072),
    active: {
      slotIndex: 0,
      slotOffset: 0,
      saveIndex: 0,
      sectorOrder: new Map(),
      checksumsValid: true,
      singleSlot: false,
      inactiveSlotOffset: 0xe000,
    },
    trainer: {
      otNameBytes: new Uint8Array(7),
      tid: 1,
      sid: 2,
      gameCode: 0,
    },
    pc: {
      currentBox: 0,
      boxes: Array.from({ length: 14 }, () =>
        Array.from({ length: 30 }, () => ({ kind: 'empty' as const })),
      ),
      boxNamesRaw: new Uint8Array(126),
      wallpapersRaw: new Uint8Array(14),
    },
    boxNames: Array.from({ length: 14 }, (_, i) => `BOX ${i + 1}`),
    warnings: [],
  };
}

function loadedBase(): Extract<AppState, { kind: 'loaded' }> {
  return {
    kind: 'loaded',
    fileName: 'src.sav',
    save: fakeSave,
    results: new Map(),
    boxIndex: 0,
    cursor: { row: 0, col: 0 },
    openMon: null,
  };
}

describe('S6a destination reducer transitions', () => {
  it('dest_file_selected populates destParsing and clears prior dest fields', () => {
    const s = reducer(loadedBase(), {
      type: 'dest_file_selected',
      file: { name: 'r.sav', size: 131072 },
    });
    if (s.kind !== 'loaded') throw new Error('expected loaded');
    expect(s.destParsing).toEqual({ fileName: 'r.sav', size: 131072 });
    expect(s.dest).toBeUndefined();
    expect(s.destParseError).toBeUndefined();
  });

  it('dest_file_parsed populates dest with cursor + boxIndex defaults', () => {
    const fake = makeFakeGen3();
    let s: AppState = loadedBase();
    s = reducer(s, { type: 'dest_file_selected', file: { name: 'r.sav', size: 131072 } });
    s = reducer(s, { type: 'dest_file_parsed', save: fake, fileName: 'r.sav' });
    if (s.kind !== 'loaded') throw new Error('expected loaded');
    expect(s.dest).toBeDefined();
    expect(s.dest!.fileName).toBe('r.sav');
    expect(s.dest!.boxIndex).toBe(0);
    expect(s.dest!.cursor).toEqual({ row: 0, col: 0 });
    expect(s.destParsing).toBeUndefined();
  });

  it('dest_file_failed populates destParseError', () => {
    const err: SaveError = { kind: 'save_error', reason: 'TOO_SHORT', message: 'short' };
    let s: AppState = loadedBase();
    s = reducer(s, { type: 'dest_file_failed', error: err, fileName: 'bad.sav' });
    if (s.kind !== 'loaded') throw new Error('expected loaded');
    expect(s.destParseError).toEqual({ fileName: 'bad.sav', error: err });
    expect(s.dest).toBeUndefined();
  });

  it('dest_clear removes dest, destParsing, destParseError, destDownload', () => {
    const fake = makeFakeGen3();
    let s: AppState = loadedBase();
    s = reducer(s, { type: 'dest_file_parsed', save: fake, fileName: 'r.sav' });
    s = reducer(s, {
      type: 'store_committed',
      save: fake,
      bytes: new Uint8Array(131072),
      suggestedFilename: 'x.sav',
    });
    s = reducer(s, { type: 'dest_clear' });
    if (s.kind !== 'loaded') throw new Error('expected loaded');
    expect(s.dest).toBeUndefined();
    expect(s.destDownload).toBeUndefined();
  });

  it('dest_cursor_move clamps within 5 rows × 6 cols', () => {
    const fake = makeFakeGen3();
    let s: AppState = loadedBase();
    s = reducer(s, { type: 'dest_file_parsed', save: fake, fileName: 'r.sav' });
    // Try to go up-left from (0,0) — should clamp.
    s = reducer(s, { type: 'dest_cursor_move', drow: -1, dcol: -1 });
    if (s.kind !== 'loaded') throw new Error('expected loaded');
    expect(s.dest!.cursor).toEqual({ row: 0, col: 0 });
    // Move right 10x — clamps at col 5.
    for (let i = 0; i < 10; i++) {
      s = reducer(s, { type: 'dest_cursor_move', drow: 0, dcol: 1 });
    }
    if (s.kind !== 'loaded') throw new Error('expected loaded');
    expect(s.dest!.cursor.col).toBe(5);
    // Move down 10x — clamps at row 4.
    for (let i = 0; i < 10; i++) {
      s = reducer(s, { type: 'dest_cursor_move', drow: 1, dcol: 0 });
    }
    if (s.kind !== 'loaded') throw new Error('expected loaded');
    expect(s.dest!.cursor.row).toBe(4);
  });

  it('dest_box_change resets cursor and clamps at 0..13', () => {
    const fake = makeFakeGen3();
    let s: AppState = loadedBase();
    s = reducer(s, { type: 'dest_file_parsed', save: fake, fileName: 'r.sav' });
    // Move cursor right twice
    s = reducer(s, { type: 'dest_cursor_move', drow: 0, dcol: 1 });
    s = reducer(s, { type: 'dest_cursor_move', drow: 0, dcol: 1 });
    // Bump box
    s = reducer(s, { type: 'dest_box_change', delta: 1 });
    if (s.kind !== 'loaded') throw new Error('expected loaded');
    expect(s.dest!.boxIndex).toBe(1);
    expect(s.dest!.cursor).toEqual({ row: 0, col: 0 });
    // Clamp at 0
    for (let i = 0; i < 5; i++) {
      s = reducer(s, { type: 'dest_box_change', delta: -1 });
    }
    if (s.kind !== 'loaded') throw new Error('expected loaded');
    expect(s.dest!.boxIndex).toBe(0);
    // Clamp at 13
    for (let i = 0; i < 25; i++) {
      s = reducer(s, { type: 'dest_box_change', delta: 1 });
    }
    if (s.kind !== 'loaded') throw new Error('expected loaded');
    expect(s.dest!.boxIndex).toBe(13);
  });

  it('store_committed updates dest.save (so the slot now shows filled) AND populates destDownload', () => {
    const fake = makeFakeGen3();
    let s: AppState = loadedBase();
    s = reducer(s, { type: 'dest_file_parsed', save: fake, fileName: 'r.sav' });
    const updated: Gen3SaveContents = {
      ...fake,
      // Pretend the inject filled box 0 slot 0
      pc: {
        ...fake.pc,
        boxes: fake.pc.boxes.map((b, i) =>
          i === 0
            ? b.map((slot, j) =>
                j === 0 ? { kind: 'filled' as const, bytes: new Uint8Array(80), species: 1 } : slot,
              )
            : b,
        ),
      },
    };
    s = reducer(s, {
      type: 'store_committed',
      save: updated,
      bytes: new Uint8Array(131072),
      suggestedFilename: 'r.modified-20260422120000.sav',
    });
    if (s.kind !== 'loaded') throw new Error('expected loaded');
    expect(s.dest!.save).toBe(updated);
    expect(s.destDownload).toBeDefined();
    expect(s.destDownload!.suggestedFilename).toBe('r.modified-20260422120000.sav');
  });

  it('reset clears EVERYTHING including dest', () => {
    const fake = makeFakeGen3();
    let s: AppState = loadedBase();
    s = reducer(s, { type: 'dest_file_parsed', save: fake, fileName: 'r.sav' });
    s = reducer(s, { type: 'reset' });
    expect(s).toBe(INITIAL_STATE);
  });

  it('dest_* actions work independently of source state (user can drop dest first)', () => {
    const fake = makeFakeGen3();
    // dest_file_parsed from idle: source still idle, dest now loaded.
    const s1 = reducer(INITIAL_STATE, { type: 'dest_file_parsed', save: fake, fileName: 'x' });
    expect(s1.kind).toBe('idle');
    expect(s1.dest?.fileName).toBe('x');
    // dest_clear unsets dest; source state still untouched.
    const s2 = reducer(s1, { type: 'dest_clear' });
    expect(s2.kind).toBe('idle');
    expect(s2.dest).toBeUndefined();
    // dest_cursor_move / dest_box_change are still no-ops without a dest.
    expect(reducer(INITIAL_STATE, { type: 'dest_cursor_move', drow: 1, dcol: 0 })).toBe(
      INITIAL_STATE,
    );
    expect(reducer(INITIAL_STATE, { type: 'dest_box_change', delta: 1 })).toBe(INITIAL_STATE);
  });

  it('dest_cursor_move / dest_box_change are no-ops when dest is undefined', () => {
    const loaded = loadedBase();
    const r1 = reducer(loaded, { type: 'dest_cursor_move', drow: 1, dcol: 0 });
    expect(r1).toBe(loaded);
    const r2 = reducer(loaded, { type: 'dest_box_change', delta: 1 });
    expect(r2).toBe(loaded);
  });
});

describe('destCursorToSlot helper', () => {
  it('maps (0,0) → 0; (0,5) → 5; (1,0) → 6; (4,5) → 29', () => {
    expect(destCursorToSlot({ row: 0, col: 0 })).toBe(0);
    expect(destCursorToSlot({ row: 0, col: 5 })).toBe(5);
    expect(destCursorToSlot({ row: 1, col: 0 })).toBe(6);
    expect(destCursorToSlot({ row: 4, col: 5 })).toBe(29);
  });
});
