/**
 * S8v2.2.1 — integration test for the dest-cursor advance over already-
 * placed slots. The handler must skip BOTH:
 *   * pre-existing dest-cart occupants (`box[i].kind === 'filled'`), AND
 *   * `previewedPlacements` from staging — slots that another staged mon
 *     in the same transfer box already points at.
 *
 * Without this, two consecutive Add-to-Dest batches could pile two
 * staged mons onto the same dest slot, silently overwriting the first
 * placement at commit time.
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

describe('runAddSelectedToDestination — placement-collision skip', () => {
  it('skips pre-placed staging slots (box 1 slots 0,2 reserved)', async () => {
    // 4 mons staged. Slots 0 and 1 already have placements pointing at
    // dest box 1 slots 0 and 2 respectively. Now place slots 2 and 3
    // starting from dest cursor (box 1, slot 0).
    //
    // Expected: slot 2 lands at destSlot=1 (skipping slot 0); slot 3
    // lands at destSlot=3 (skipping slot 2).
    const placement0 = {
      destBoxIndex: 1,
      destSlot: 0,
      destCartLabel: 'emerald.sav',
      destTid: 99999,
      destFormat: 'rse' as const,
    };
    const placement1 = { ...placement0, destSlot: 2 };
    const seedSlots = [
      makeSlot(0, { placement: placement0 }),
      makeSlot(1, { placement: placement1 }),
      makeSlot(2),
      makeSlot(3),
      ...Array.from({ length: 26 }, () => null),
    ];
    const store = new FakeStagingStore();
    store.seed(seedSlots);

    const sourceSave = makeGen2SaveWithBox0([]);
    const destSave = makeGen3Save();
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
      v2TransferSelection: [2, 3],
      staging: {
        slots: seedSlots,
        stagedMons: [],
        rightPaneSubview: 'staging',
        sessionMetadata: { createdAt: 'iso', lastModifiedAt: 'iso' },
      },
    };

    const setSpy = vi.spyOn(store, 'setPlacement');
    const dispatched: Action[] = [];

    await runAddSelectedToDestination(state, (a) => dispatched.push(a), makeDeps(store));

    expect(setSpy).toHaveBeenCalledTimes(2);
    const calls = setSpy.mock.calls;
    expect(calls[0]?.[0]).toBe(2);
    expect(calls[0]?.[1]?.destSlot).toBe(1);
    expect(calls[1]?.[0]).toBe(3);
    expect(calls[1]?.[1]?.destSlot).toBe(3);
    // No placement-overflow banner — there's plenty of room.
    const overflow = dispatched.find((a) => a.type === 'v2_transfer_placement_banner');
    expect(overflow).toBeUndefined();
  });

  it('skips BOTH pre-existing dest-cart occupants AND previewedPlacements', async () => {
    // Slot 0 staged with placement → dest box 1 slot 0.
    // Slot 1, slot 2 also staged but unplaced.
    // Dest box 1 has actual occupant at slot 4.
    // Selection: [1, 2] from cursor (box 1 slot 0).
    // Expected: slot 1 → destSlot=1 (skipping previewed slot 0)
    //           slot 2 → destSlot=2 (slot 4 is later, doesn't affect)
    // Then add a third selection [3 (an unplaced staged slot)] from
    // cursor (box 1, slot 3) → should skip dest-cart slot 4 and land
    // at destSlot=3, then 5 if forced. Use a single combined selection
    // to keep the assertion focused.
    const placement0 = {
      destBoxIndex: 1,
      destSlot: 0,
      destCartLabel: 'emerald.sav',
      destTid: 99999,
      destFormat: 'rse' as const,
    };
    const seedSlots = [
      makeSlot(0, { placement: placement0 }),
      makeSlot(1),
      makeSlot(2),
      makeSlot(3),
      makeSlot(4),
      ...Array.from({ length: 25 }, () => null),
    ];
    const store = new FakeStagingStore();
    store.seed(seedSlots);

    const sourceSave = makeGen2SaveWithBox0([]);
    // Dest box 1 has slot 4 pre-occupied by a real cart mon.
    const destSave = makeGen3Save([{ boxIndex: 1, slot: 4 }]);
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
      v2TransferSelection: [1, 2, 3, 4],
      staging: {
        slots: seedSlots,
        stagedMons: [],
        rightPaneSubview: 'staging',
        sessionMetadata: { createdAt: 'iso', lastModifiedAt: 'iso' },
      },
    };
    const setSpy = vi.spyOn(store, 'setPlacement');

    await runAddSelectedToDestination(state, () => undefined, makeDeps(store));

    // Reserved: slot 0 (previewed by staged slot 0) + slot 4 (dest-cart
    // occupant). Cursor scan starts at 0, skips 0 → 1 (place slot 1),
    // 2 (place slot 2), 3 (place slot 3), 4 reserved → 5 (place slot 4).
    expect(setSpy).toHaveBeenCalledTimes(4);
    const destSlots = setSpy.mock.calls.map((c) => c[1]?.destSlot);
    expect(destSlots).toEqual([1, 2, 3, 5]);
  });
});
