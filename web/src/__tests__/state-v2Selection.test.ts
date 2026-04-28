/**
 * S8v2.2 — reducer tests for the v2 multi-select interaction model.
 *
 * Covers (per AMEND-S8v2.2 §2.1 + DECISION-S8v2.2-6):
 *   - `v2_select_toggle` replace / add / range modes for source + dest.
 *   - `v2_select_clear` is side-tagged.
 *   - `v2_transfer_select_toggle` symmetry on slot-index selection.
 *   - `withSelectionsCleared` is invoked from EVERY context-shifting
 *     action (action-union iteration test).
 *   - Banner set/dismiss for the four banner actions.
 *   - source_clear preserves staging (per edge case 3b).
 */

import { describe, it, expect } from 'vitest';
import {
  reducer,
  INITIAL_STATE,
  type AppState,
  type Action,
  type MonRef,
} from '../state.js';
import type { Gen3SaveContents, SaveContents } from '@pokeportal/core';

const refA: MonRef = { bucket: 'box', boxIndex: 0, slot: 0 };
const refB: MonRef = { bucket: 'box', boxIndex: 0, slot: 1 };
const refC: MonRef = { bucket: 'box', boxIndex: 0, slot: 5 };

const fakeSave: SaveContents = {
  format: 'CRYSTAL',
  trainer: { name: 'TEST', nameBytes: new Uint8Array(11), tid: 1234 },
  party: [],
  boxes: Array.from({ length: 14 }, () => []),
  warnings: [],
};

function makeLoaded(): AppState {
  return {
    kind: 'loaded',
    fileName: 'x',
    save: fakeSave,
    sourceBytes: new Uint8Array(32768),
    results: new Map(),
    boxIndex: 0,
    cursor: { row: 0, col: 0 },
    openMon: null,
  };
}

function fakeGen3Save(): Gen3SaveContents {
  type AnySlot = { kind: 'empty' } | { kind: 'filled'; bytes: Uint8Array; species: number };
  const boxes = Array.from({ length: 14 }, () =>
    Array.from({ length: 30 }, (): AnySlot => ({ kind: 'empty' })),
  );
  return {
    kind: 'gen3_save',
    format: 'EMERALD',
    family: 'EMERALD',
    bytes: new Uint8Array(131072),
    active: {
      slotIndex: 0,
      slotOffset: 0,
      saveIndex: 1,
      sectorOrder: new Map(),
      checksumsValid: true,
      singleSlot: false,
      inactiveSlotOffset: 0xe000,
    },
    trainer: { otNameBytes: new Uint8Array(7), tid: 0, sid: 0, gameCode: 0xbcf3_4f1f },
    pc: {
      currentBox: 0,
      boxes,
      boxNamesRaw: new Uint8Array(126),
      wallpapersRaw: new Uint8Array(14),
    },
    boxNames: Array.from({ length: 14 }, (_, i) => `BOX ${i + 1}`),
    warnings: [],
  };
}

describe('v2_select_toggle (source side)', () => {
  it('replace mode replaces selection with the single ref', () => {
    let s: AppState = INITIAL_STATE;
    s = reducer(s, {
      type: 'v2_select_toggle',
      side: 'source',
      ref: refA,
      mode: 'replace',
      slotInBox: 0,
    });
    expect(s.v2SourceSelection).toEqual([refA]);
    s = reducer(s, {
      type: 'v2_select_toggle',
      side: 'source',
      ref: refB,
      mode: 'replace',
      slotInBox: 1,
    });
    expect(s.v2SourceSelection).toEqual([refB]);
    expect(s.v2SourceSelectionAnchor).toEqual(refB);
  });

  it('add mode appends de-dupes; toggle removes existing', () => {
    let s: AppState = INITIAL_STATE;
    s = reducer(s, {
      type: 'v2_select_toggle',
      side: 'source',
      ref: refA,
      mode: 'add',
      slotInBox: 0,
    });
    s = reducer(s, {
      type: 'v2_select_toggle',
      side: 'source',
      ref: refB,
      mode: 'add',
      slotInBox: 1,
    });
    expect(s.v2SourceSelection).toEqual([refA, refB]);
    // Toggle off refA.
    s = reducer(s, {
      type: 'v2_select_toggle',
      side: 'source',
      ref: refA,
      mode: 'add',
      slotInBox: 0,
    });
    expect(s.v2SourceSelection).toEqual([refB]);
  });

  it('range mode with anchor selects inclusive range filtered to occupied refs', () => {
    let s: AppState = INITIAL_STATE;
    // Anchor at slot 1.
    s = reducer(s, {
      type: 'v2_select_toggle',
      side: 'source',
      ref: refB,
      mode: 'replace',
      slotInBox: 1,
    });
    // Range click to slot 5 — entries at slots 0,1,5 should be picked.
    s = reducer(s, {
      type: 'v2_select_toggle',
      side: 'source',
      ref: refC,
      mode: 'range',
      slotInBox: 5,
      entries: [
        { ref: refA, slotInBox: 0 },
        { ref: refB, slotInBox: 1 },
        { ref: refC, slotInBox: 5 },
      ],
    });
    expect(s.v2SourceSelection).toEqual([refB, refC]);
  });

  it('range mode without anchor falls back to replace', () => {
    let s: AppState = INITIAL_STATE;
    s = reducer(s, {
      type: 'v2_select_toggle',
      side: 'source',
      ref: refA,
      mode: 'range',
      slotInBox: 0,
    });
    expect(s.v2SourceSelection).toEqual([refA]);
  });

  it('side-tagged: source select preserves dest selection', () => {
    let s: AppState = INITIAL_STATE;
    s = reducer(s, {
      type: 'v2_select_toggle',
      side: 'dest',
      ref: refA,
      mode: 'replace',
      slotInBox: 0,
    });
    s = reducer(s, {
      type: 'v2_select_toggle',
      side: 'source',
      ref: refB,
      mode: 'replace',
      slotInBox: 1,
    });
    expect(s.v2SourceSelection).toEqual([refB]);
    expect(s.v2DestSelection).toEqual([refA]);
  });
});

describe('v2_select_clear', () => {
  it('side-tagged: clearing source preserves dest', () => {
    let s: AppState = INITIAL_STATE;
    s = reducer(s, {
      type: 'v2_select_toggle',
      side: 'source',
      ref: refA,
      mode: 'replace',
      slotInBox: 0,
    });
    s = reducer(s, {
      type: 'v2_select_toggle',
      side: 'dest',
      ref: refB,
      mode: 'replace',
      slotInBox: 1,
    });
    s = reducer(s, { type: 'v2_select_clear', side: 'source' });
    expect(s.v2SourceSelection).toBeUndefined();
    expect(s.v2SourceSelectionAnchor).toBeUndefined();
    expect(s.v2DestSelection).toEqual([refB]);
  });
});

describe('v2_transfer_select_toggle', () => {
  it('replace / add / clear semantics on slot indices', () => {
    let s: AppState = INITIAL_STATE;
    s = reducer(s, { type: 'v2_transfer_select_toggle', idx: 5, mode: 'replace' });
    expect(s.v2TransferSelection).toEqual([5]);
    s = reducer(s, { type: 'v2_transfer_select_toggle', idx: 9, mode: 'add' });
    expect(s.v2TransferSelection).toEqual([5, 9]);
    s = reducer(s, { type: 'v2_transfer_select_toggle', idx: 5, mode: 'add' });
    expect(s.v2TransferSelection).toEqual([9]);
    s = reducer(s, { type: 'v2_transfer_select_clear' });
    expect(s.v2TransferSelection).toBeUndefined();
  });

  it('range mode picks inclusive [anchor, click] filtered to occupied slots', () => {
    // Seed staging.slots with slots 2 + 5 occupied.
    const slot = (idx: number): {
      idx: number;
      pkBytes: Uint8Array;
      speciesId: number;
      nicknameDisplay: string;
      sourceCartLabel: string;
      sourceTid: number;
      sourceFamily: 'gen2';
      sourceOtName: string;
      sourceRef: MonRef;
      sourceRefKey: string;
      stagedAt: string;
      placement: null;
    } => ({
      idx,
      pkBytes: new Uint8Array([0xfe, idx]),
      speciesId: 158,
      nicknameDisplay: 'X',
      sourceCartLabel: 'A',
      sourceTid: 1,
      sourceFamily: 'gen2',
      sourceOtName: 'OT',
      sourceRef: { bucket: 'box', boxIndex: 0, slot: idx },
      sourceRefKey: `A|1|box:0:${idx}`,
      stagedAt: `${idx}`,
      placement: null,
    });
    const slots = Array.from({ length: 30 }, () => null) as Array<unknown>;
    slots[2] = slot(2);
    slots[5] = slot(5);
    const seed: AppState = {
      kind: 'idle',
      staging: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        slots: slots as any,
        stagedMons: [],
        rightPaneSubview: 'staging',
        sessionMetadata: { createdAt: 'iso', lastModifiedAt: 'iso' },
      },
    };
    let s: AppState = seed;
    // Anchor at slot 2.
    s = reducer(s, { type: 'v2_transfer_select_toggle', idx: 2, mode: 'replace' });
    // Range to 9 — should pick 2 and 5 only.
    s = reducer(s, { type: 'v2_transfer_select_toggle', idx: 9, mode: 'range' });
    expect(s.v2TransferSelection).toEqual([2, 5]);
  });
});

describe('action-union iteration: every context-shifting action clears v2 selections', () => {
  // DECISION-S8v2.2-6 — typed against `Action['type']` so adding a new
  // action without addressing it is a TypeScript error.
  const ACTIONS_THAT_CLEAR_SELECTIONS: ReadonlyArray<Action['type']> = [
    'v2_switch_role',
    'box_change',
    'dest_box_change',
    'dest_clear',
    'dest_file_parsed',
    'cart_connect_succeeded',
    'cart_dest_connect_succeeded',
    'staging_cleared',
    // Note: `source_clear`, `file_parsed`, `reset` are tested separately
    // below — `reset` returns INITIAL_STATE so selections are gone by
    // virtue of the fresh state; `file_parsed` returns a fresh `loaded`
    // state (also fresh). `source_clear` builds its own state shape
    // (idle preserving sticky CartSlot fields) — also fresh.
  ];

  function seededWithSelections(seed: AppState): AppState {
    return {
      ...seed,
      v2SourceSelection: [refA],
      v2SourceSelectionAnchor: refA,
      v2DestSelection: [refB],
      v2DestSelectionAnchor: refB,
      v2TransferSelection: [3],
      v2TransferSelectionAnchor: 3,
    };
  }

  function mkAction(t: Action['type']): Action {
    switch (t) {
      case 'v2_switch_role':
        return { type: 'v2_switch_role' };
      case 'box_change':
        return { type: 'box_change', delta: 1 };
      case 'dest_box_change':
        return { type: 'dest_box_change', delta: 1 };
      case 'dest_clear':
        return { type: 'dest_clear' };
      case 'dest_file_parsed':
        return { type: 'dest_file_parsed', save: fakeGen3Save(), fileName: 'x.sav' };
      case 'cart_connect_succeeded':
        return {
          type: 'cart_connect_succeeded',
          connection: { variant: 'insidegadgets', deviceId: 'X' },
          save: fakeSave,
          bytes: new Uint8Array(32768),
          fileName: 'x.sav',
        };
      case 'cart_dest_connect_succeeded':
        return {
          type: 'cart_dest_connect_succeeded',
          connection: { variant: 'insidegadgets', deviceId: 'X' },
          save: fakeGen3Save(),
          bytes: new Uint8Array(131072),
          fileName: 'x.sav',
        };
      case 'staging_cleared':
        return { type: 'staging_cleared' };
      default:
        throw new Error(`unhandled ${t as string}`);
    }
  }

  for (const at of ACTIONS_THAT_CLEAR_SELECTIONS) {
    it(`${at} clears all three v2 selections + anchors`, () => {
      // box_change needs a 'loaded' state with a multi-box save so the
      // delta actually moves; dest_box_change needs `state.dest`. Seed
      // accordingly.
      let seed: AppState = makeLoaded();
      if (at === 'dest_box_change' || at === 'dest_clear' || at === 'cart_dest_connect_succeeded') {
        seed = {
          ...seed,
          dest: {
            fileName: 'x.sav',
            save: fakeGen3Save(),
            boxIndex: 0,
            cursor: { row: 0, col: 0 },
          },
        };
      }
      if (at === 'staging_cleared') {
        seed = {
          ...seed,
          staging: {
            slots: Array.from({ length: 30 }, () => null),
            stagedMons: [],
            rightPaneSubview: 'staging',
            sessionMetadata: { createdAt: 'iso', lastModifiedAt: 'iso' },
          },
        };
      }
      const seeded = seededWithSelections(seed);
      const next = reducer(seeded, mkAction(at));
      expect(next.v2SourceSelection).toBeUndefined();
      expect(next.v2DestSelection).toBeUndefined();
      expect(next.v2TransferSelection).toBeUndefined();
      expect(next.v2SourceSelectionAnchor).toBeUndefined();
      expect(next.v2DestSelectionAnchor).toBeUndefined();
      expect(next.v2TransferSelectionAnchor).toBeUndefined();
    });
  }

  it('source_clear clears v2 selections AND preserves staging.slots (edge case 3b)', () => {
    const slots = Array.from({ length: 30 }, () => null);
    const seeded: AppState = {
      ...seededWithSelections(makeLoaded()),
      staging: {
        slots,
        stagedMons: [],
        rightPaneSubview: 'staging',
        sessionMetadata: { createdAt: 'iso', lastModifiedAt: 'iso' },
      },
    };
    const next = reducer(seeded, { type: 'source_clear' });
    expect(next.v2SourceSelection).toBeUndefined();
    expect(next.v2DestSelection).toBeUndefined();
    expect(next.v2TransferSelection).toBeUndefined();
    expect(next.staging?.slots).toBe(slots);
  });
});

describe('banner set/dismiss', () => {
  it('v2_transfer_box_full sets and dismiss clears', () => {
    let s: AppState = INITIAL_STATE;
    s = reducer(s, { type: 'v2_transfer_box_full', skipped: 3 });
    expect(s.transferBoxFullBanner).toEqual({ skipped: 3 });
    s = reducer(s, { type: 'v2_transfer_box_full_dismiss' });
    expect(s.transferBoxFullBanner).toBeUndefined();
  });

  it('v2_transfer_placement_banner sets and dismiss clears', () => {
    let s: AppState = INITIAL_STATE;
    s = reducer(s, { type: 'v2_transfer_placement_banner', unplaced: 2 });
    expect(s.transferPlacementBanner).toEqual({ unplaced: 2 });
    s = reducer(s, { type: 'v2_transfer_placement_banner_dismiss' });
    expect(s.transferPlacementBanner).toBeUndefined();
  });

  it('v2_transfer_convert_skip sets and dismiss clears', () => {
    let s: AppState = INITIAL_STATE;
    s = reducer(s, { type: 'v2_transfer_convert_skip', skipped: 1 });
    expect(s.transferConvertSkipBanner).toEqual({ skipped: 1 });
    s = reducer(s, { type: 'v2_transfer_convert_skip_dismiss' });
    expect(s.transferConvertSkipBanner).toBeUndefined();
  });

  it('staging_migration_overflow sets and dismiss clears', () => {
    let s: AppState = INITIAL_STATE;
    s = reducer(s, { type: 'staging_migration_overflow', dropped: 5 });
    expect(s.stagingMigrationOverflowBanner).toEqual({ dropped: 5 });
    s = reducer(s, { type: 'staging_migration_overflow_dismiss' });
    expect(s.stagingMigrationOverflowBanner).toBeUndefined();
  });
});
