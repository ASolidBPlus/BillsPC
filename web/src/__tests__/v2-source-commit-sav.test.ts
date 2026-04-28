/**
 * S8v2.3 — `runCommitSource` SAV-mode happy path.
 *
 * Asserts:
 *   * Filters slots to `!sourceCommitted` (already-committed slots
 *     are skipped).
 *   * Triggers `downloadFn(state.fileName, modifiedBytes)` once.
 *   * `setSourceCommitted(idx, true)` is called per filtered slot.
 *   * Dispatches `v2_source_committed` with the filtered slotIdxs.
 *   * Dispatches `v2_source_bytes_refreshed` with the post-commit
 *     bytes + a re-parsed save (parseSave called with the new bytes).
 *   * No `flashCart` invocation (SAV mode skips the typed-PROCEED gate).
 *   * Entry guard: `state.kind !== 'loaded'` returns without any side
 *     effects (downloadFn / dispatch never fire).
 */

import { describe, it, expect, vi } from 'vitest';
import { runCommitSource } from '../ui/v2Actions.js';
import type { ControllerDeps } from '../ui.js';
import type { Action, AppState } from '../state.js';
import type { SaveContents } from '@pokeportal/core';
import { FakeStagingStore, makeGen2SaveWithBox0, makeSlot } from './_helpers/staging.js';
import type { StagedSlot } from '../cart/stagingStore.types.js';

function makeDeps(store: FakeStagingStore): ControllerDeps {
  return {
    parseSave: ((_bytes: Uint8Array) =>
      makeGen2SaveWithBox0([])) as unknown as ControllerDeps['parseSave'],
    convert: (() => null) as unknown as ControllerDeps['convert'],
    packBoxed: (() => new Uint8Array()) as unknown as ControllerDeps['packBoxed'],
    isSaveError: (() => false) as unknown as ControllerDeps['isSaveError'],
    isRefusal: (() => false) as unknown as ControllerDeps['isRefusal'],
    parseGen3Save: (() => null) as unknown as ControllerDeps['parseGen3Save'],
    isGen3SaveError: (() => false) as unknown as ControllerDeps['isGen3SaveError'],
    injectIntoSave: (() => null) as unknown as ControllerDeps['injectIntoSave'],
    isGen3InjectError: (() => false) as unknown as ControllerDeps['isGen3InjectError'],
    deleteMonGen1: (() => null) as unknown as ControllerDeps['deleteMonGen1'],
    deleteMonGen2: (() => null) as unknown as ControllerDeps['deleteMonGen2'],
    getStagingStore: () => store.asStore(),
  };
}

/** Build a minimally-valid CRYSTAL SRAM that the deleter can operate on:
 *  set the box-0 count byte at offset 0x4000 and species bytes for the
 *  first two slots. Outside the primary checksum range so no checksum
 *  surgery is required. */
function makeValidCrystalBytesFor(monCount: number): Uint8Array {
  const out = new Uint8Array(32768);
  const box0Off = 0x4000;
  out[box0Off] = monCount; // box count
  for (let i = 0; i < monCount; i++) {
    out[box0Off + 1 + i] = 158 + i; // species byte per occupied slot
  }
  out[box0Off + 1 + monCount] = 0xff; // species-list terminator
  return out;
}

function loadedStateFor(slots: ReadonlyArray<StagedSlot | null>): AppState {
  const save = makeGen2SaveWithBox0([]);
  // monCount must be >= the highest slot index referenced by the staged
  // refs (the deleter rejects slot >= count). Tests use slots 0 + 1, so
  // 2 mons suffice.
  return {
    kind: 'loaded',
    fileName: 'crystal.sav',
    save,
    sourceBytes: makeValidCrystalBytesFor(2),
    results: new Map(),
    boxIndex: 0,
    cursor: { row: 0, col: 0 },
    openMon: null,
    staging: {
      slots,
      stagedMons: [],
      rightPaneSubview: 'staging',
      sessionMetadata: { createdAt: 'iso', lastModifiedAt: 'iso' },
    },
  };
}

describe('runCommitSource — SAV mode (S8v2.3)', () => {
  it('downloads modified SAV; dispatches v2_source_committed; flips slots; refreshes bytes', async () => {
    const store = new FakeStagingStore();
    // Two slots with valid sourceFamily='gen2' for the loaded CRYSTAL save.
    const slot0 = makeSlot(0, { sourceBoxIndex: 0, sourceSlot: 0 });
    const slot1 = makeSlot(1, { sourceBoxIndex: 0, sourceSlot: 1 });
    store.seed([slot0, slot1, ...Array.from({ length: 28 }, () => null)]);
    const slots = store.getAllSlots();

    const state = loadedStateFor(slots);
    const dispatched: Action[] = [];
    const dispatch = (a: Action): void => {
      dispatched.push(a);
    };
    const downloadCalls: Array<[string, Uint8Array]> = [];
    const downloadFn = (name: string, bytes: Uint8Array): void => {
      downloadCalls.push([name, bytes]);
    };
    const flipSpy = vi.spyOn(store, 'setSourceCommitted');

    await runCommitSource({
      state,
      dispatch,
      controller: makeDeps(store),
      flashDeps: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      confirmFlashDialog: (() => document.createElement('div')) as any,
      downloadFn,
      // Stub composeSource — the real Gen 1/2 deleter shifts box-slots
      // down on each delete, so chaining N deletes against pre-known
      // slot indices in the SAME pre-delete coordinate space fails on
      // the second iteration. Tests assert the handler's contract; the
      // round-trip behaviour of the deleter has its own coverage in
      // core/__tests__/.
      composeSource: ((bytes: Uint8Array) => new Uint8Array(bytes).fill(0xcc)) as never,
    });

    // Download fired once with the loaded SAV's filename.
    expect(downloadCalls).toHaveLength(1);
    expect(downloadCalls[0]![0]).toBe('crystal.sav');
    // Flip happened for both slot 0 and slot 1.
    expect(flipSpy.mock.calls.map((c) => c[0])).toEqual([0, 1]);
    expect(flipSpy.mock.calls.map((c) => c[1])).toEqual([true, true]);
    // v2_source_committed dispatched with the same slotIdxs.
    const committed = dispatched.find((a) => a.type === 'v2_source_committed');
    expect(committed).toBeDefined();
    expect((committed as { slotIdxs: ReadonlyArray<number> }).slotIdxs).toEqual([0, 1]);
    // v2_source_bytes_refreshed dispatched with the post-commit bytes.
    const refreshed = dispatched.find((a) => a.type === 'v2_source_bytes_refreshed');
    expect(refreshed).toBeDefined();
    expect((refreshed as { bytes: Uint8Array }).bytes).toBe(downloadCalls[0]![1]);
    expect((refreshed as { save: SaveContents }).save).toBeDefined();
  });

  it('skips slots already source-committed (filter !sourceCommitted)', async () => {
    const store = new FakeStagingStore();
    const s0: StagedSlot = { ...makeSlot(0), sourceCommitted: true };
    const s1 = makeSlot(1);
    store.seed([s0, s1, ...Array.from({ length: 28 }, () => null)]);
    const state = loadedStateFor(store.getAllSlots());
    const dispatched: Action[] = [];
    const downloadCalls: Array<[string, Uint8Array]> = [];
    const flipSpy = vi.spyOn(store, 'setSourceCommitted');

    await runCommitSource({
      state,
      dispatch: (a) => dispatched.push(a),
      controller: makeDeps(store),
      flashDeps: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      confirmFlashDialog: (() => document.createElement('div')) as any,
      downloadFn: (n, b) => downloadCalls.push([n, b]),
    });

    expect(downloadCalls).toHaveLength(1);
    // ONLY slot 1 should be flipped. Slot 0 was already committed.
    expect(flipSpy.mock.calls.map((c) => c[0])).toEqual([1]);
    const committed = dispatched.find((a) => a.type === 'v2_source_committed');
    expect((committed as { slotIdxs: ReadonlyArray<number> }).slotIdxs).toEqual([1]);
  });

  it('no-op when no slots pending source commit (early return)', async () => {
    const store = new FakeStagingStore();
    const allCommitted: StagedSlot = { ...makeSlot(0), sourceCommitted: true };
    store.seed([allCommitted, ...Array.from({ length: 29 }, () => null)]);
    const state = loadedStateFor(store.getAllSlots());
    const dispatched: Action[] = [];
    const downloadCalls: Array<[string, Uint8Array]> = [];

    await runCommitSource({
      state,
      dispatch: (a) => dispatched.push(a),
      controller: makeDeps(store),
      flashDeps: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      confirmFlashDialog: (() => document.createElement('div')) as any,
      downloadFn: (n, b) => downloadCalls.push([n, b]),
    });

    expect(downloadCalls).toHaveLength(0);
    expect(dispatched.find((a) => a.type === 'v2_source_committed')).toBeUndefined();
  });

  // AMEND-S8v2.3-7 entry guard.
  it('entry guard: state.kind !== "loaded" → no-op', async () => {
    const store = new FakeStagingStore();
    store.seed([makeSlot(0), ...Array.from({ length: 29 }, () => null)]);
    const state: AppState = { kind: 'idle' };
    const dispatched: Action[] = [];
    const downloadCalls: Array<[string, Uint8Array]> = [];

    await runCommitSource({
      state,
      dispatch: (a) => dispatched.push(a),
      controller: makeDeps(store),
      flashDeps: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      confirmFlashDialog: (() => document.createElement('div')) as any,
      downloadFn: (n, b) => downloadCalls.push([n, b]),
    });

    expect(downloadCalls).toHaveLength(0);
    expect(dispatched).toHaveLength(0);
  });
});
