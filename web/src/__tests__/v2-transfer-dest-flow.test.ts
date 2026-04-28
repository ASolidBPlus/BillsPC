/**
 * S8v2.2.1 — integration test for the TRANSFER → DEST placement pipeline.
 *
 * Invokes the production `runAddSelectedToDestination` handler against a
 * spied FakeStagingStore. Asserts:
 *   * `setPlacement` is called exactly once per selected transfer slot.
 *   * Each placement's `destBoxIndex` matches the dest cursor's box.
 *   * `destSlot` advances 0,1,2... and SKIPS dest-cart-occupied slots
 *     (fixture has slot 2 pre-filled in dest box 1; the placement
 *     advance must skip slot 2).
 *   * `removeAt` and `clear` are NEVER called (the load-bearing v2.3
 *     boundary, AMEND-S8v2.2-6).
 *   * `state.dest.save` is NOT mutated.
 *   * `dispatch({type:'v2_transfer_select_clear'})` is dispatched.
 */

import { describe, it, expect, vi } from 'vitest';
import { runAddSelectedToDestination } from '../ui/v2Actions.js';
import type { ControllerDeps } from '../ui.js';
import type { Action, AppState } from '../state.js';
import {
  FakeStagingStore,
  makeGen2SaveWithBox0,
  makeGen3Save,
  makeSlot,
} from './_helpers/staging.js';

function makeDeps(store: FakeStagingStore): ControllerDeps {
  return {
    parseSave: (() => null) as unknown as ControllerDeps['parseSave'],
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

describe('runAddSelectedToDestination — TRANSFER → DEST placement pipeline', () => {
  it('places selected slots; advances destSlot; skips pre-occupied dest slot 2', async () => {
    // 5 mons staged in slots 0..4. Dest box 1 has slot 2 pre-occupied
    // so the placement run must produce destSlots [0, 1, 3, 4, 5].
    const store = new FakeStagingStore();
    const seedSlots = Array.from({ length: 30 }, (_, i) =>
      i < 5 ? makeSlot(i) : null,
    );
    store.seed(seedSlots);

    const destSave = makeGen3Save([{ boxIndex: 1, slot: 2 }]);
    const sourceSave = makeGen2SaveWithBox0([]);
    const state: AppState = {
      kind: 'loaded',
      fileName: 'crystal.sav',
      save: sourceSave,
      sourceBytes: new Uint8Array(32768),
      results: new Map(),
      boxIndex: 0,
      cursor: { row: 0, col: 0 },
      openMon: null,
      dest: {
        fileName: 'emerald.sav',
        save: destSave,
        boxIndex: 1,
        cursor: { row: 0, col: 0 },
      },
      v2TransferSelection: [0, 1, 2, 3, 4],
      staging: {
        slots: seedSlots,
        stagedMons: [],
        rightPaneSubview: 'staging',
        sessionMetadata: { createdAt: 'iso', lastModifiedAt: 'iso' },
      },
    };
    const destSnapshot = JSON.parse(
      JSON.stringify(destSave, (_k, v) => (v instanceof Uint8Array ? Array.from(v) : v)),
    );

    const setSpy = vi.spyOn(store, 'setPlacement');
    const removeSpy = vi.spyOn(store, 'removeAt');
    const clearSpy = vi.spyOn(store, 'clear');
    const dispatched: Action[] = [];

    await runAddSelectedToDestination(state, (a) => dispatched.push(a), makeDeps(store));

    expect(setSpy).toHaveBeenCalledTimes(5);
    const calls = setSpy.mock.calls;
    // transferIdx call order matches the selection.
    expect(calls.map((c) => c[0])).toEqual([0, 1, 2, 3, 4]);
    // All placements target dest box 1.
    for (const [, placement] of calls) {
      expect(placement?.destBoxIndex).toBe(1);
    }
    // destSlot advances 0,1,3,4,5 — slot 2 was pre-occupied in dest cart.
    expect(calls.map((c) => c[1]?.destSlot)).toEqual([0, 1, 3, 4, 5]);

    // Load-bearing v2.3 boundary.
    expect(removeSpy).not.toHaveBeenCalled();
    expect(clearSpy).not.toHaveBeenCalled();

    // Dest save bytes untouched.
    expect(
      JSON.parse(
        JSON.stringify(destSave, (_k, v) => (v instanceof Uint8Array ? Array.from(v) : v)),
      ),
    ).toEqual(destSnapshot);

    // Transfer-selection clear dispatched (no idxsOverride).
    expect(dispatched).toEqual(
      expect.arrayContaining([{ type: 'v2_transfer_select_clear' }]),
    );
  });
});
