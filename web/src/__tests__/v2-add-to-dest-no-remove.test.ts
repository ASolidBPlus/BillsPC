/**
 * S8v2.2 — DEDICATED negative-assertion test for the
 * placement-vs-commit boundary (AMEND-S8v2.2-6 / -R2).
 *
 * The Add-to-Destination handler MUST ONLY call `setPlacement`. It MUST
 * NOT call `removeAt` or `clear` — the MOVE-out-of-transfer is the
 * v2.3 commit step. A subtle bug like "we have the slot index in the
 * placement loop, why not just call removeAt(idx) too?" would silently
 * break the contract; this test stays in its own file so it can't get
 * accidentally refactored away.
 *
 * S8v2.2.1 — REWIRED to invoke the production
 * `runAddSelectedToDestination` handler (extracted to
 * `web/src/ui/v2Actions.ts`) against a spied real `StagingStore`. The
 * prior version re-implemented the handler's contract inline in the
 * test, which masked any divergence between the test's contract and
 * the production handler's actual behaviour.
 *
 * Code review (human or Code Evaluator) MUST re-run THIS test
 * specifically before any PR merge.
 */

import { describe, it, expect, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { reducer, INITIAL_STATE, type AppState, type Action } from '../state.js';
import { StagingStore, deriveSourceRefKey } from '../cart/stagingStore.js';
import { STAGING_DB_NAME, type StagedSlot } from '../cart/stagingStore.types.js';
import { runAddSelectedToDestination } from '../ui/v2Actions.js';
import type { ControllerDeps } from '../ui.js';
import { makeGen2SaveWithBox0, makeGen3Save } from './_helpers/staging.js';

let dbCounter = 0;
function nextDbName(): string {
  dbCounter++;
  return `${STAGING_DB_NAME}-no-remove-${dbCounter}`;
}

function payload(slot: number): Omit<StagedSlot, 'idx' | 'placement'> {
  const sourceRef = { bucket: 'box' as const, boxIndex: 0, slot };
  return {
    pkBytes: new Uint8Array([0xfe, slot]),
    speciesId: 158 + slot,
    nicknameDisplay: `MON${slot}`,
    sourceCartLabel: 'POKEMON CRYSTAL',
    sourceTid: 12345,
    sourceFamily: 'gen2',
    sourceOtName: 'JOEL',
    sourceRef,
    sourceRefKey: deriveSourceRefKey('POKEMON CRYSTAL', 12345, sourceRef),
    stagedAt: `2026-04-25T10:00:00.${slot}Z`,
  };
}

function makeDeps(store: StagingStore): ControllerDeps {
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
    getStagingStore: () => store,
  };
}

describe('Add-to-Destination MUST NOT remove from transfer (AMEND-S8v2.2-6)', () => {
  it('setPlacement called per selected slot; removeAt / clear NEVER called', async () => {
    // Use a REAL StagingStore (fake-indexeddb-backed) so the spies
    // mount on the actual production class — not a duck-typed fake.
    const store = await StagingStore.open(nextDbName());
    await store.placeAt(0, payload(0));
    await store.placeAt(1, payload(1));
    await store.placeAt(2, payload(2));

    const setSpy = vi.spyOn(store, 'setPlacement');
    const removeSpy = vi.spyOn(store, 'removeAt');
    const clearSpy = vi.spyOn(store, 'clear');

    const sourceSave = makeGen2SaveWithBox0([]);
    const slotsSnapshot = store.getAllSlots();
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
        save: makeGen3Save(),
        boxIndex: 0,
        cursor: { row: 0, col: 0 },
      },
      v2TransferSelection: [0, 1, 2],
      staging: {
        slots: slotsSnapshot,
        stagedMons: [],
        rightPaneSubview: 'staging',
        sessionMetadata: { createdAt: 'iso', lastModifiedAt: 'iso' },
      },
    };

    await runAddSelectedToDestination(state, () => undefined, makeDeps(store));

    expect(setSpy).toHaveBeenCalledTimes(3);
    expect(setSpy.mock.calls.map((c) => c[1]?.destSlot)).toEqual([0, 1, 2]);

    // The load-bearing assertions:
    expect(removeSpy).not.toHaveBeenCalled();
    expect(clearSpy).not.toHaveBeenCalled();

    // Slots 0..2 are STILL OCCUPIED + each has placement !== null.
    for (const idx of [0, 1, 2]) {
      const slot = store.getSlot(idx);
      expect(slot).not.toBeNull();
      expect(slot?.placement).not.toBeNull();
    }
    store.close();
  });

  it('reducer: source_clear preserves staging.slots byte-identical (edge case 3b)', () => {
    // Independent reducer-only check: source_clear must NOT touch the
    // transfer box. Pair-tested with the integration-style spy above.
    const occupied: StagedSlot = {
      idx: 0,
      pkBytes: new Uint8Array([0xfe, 0]),
      speciesId: 158,
      nicknameDisplay: 'X',
      sourceCartLabel: 'A',
      sourceTid: 1,
      sourceFamily: 'gen2',
      sourceOtName: 'OT',
      sourceRef: { bucket: 'box', boxIndex: 0, slot: 0 },
      sourceRefKey: 'A|1|box:0:0',
      stagedAt: 'iso',
      placement: null,
    };
    const slots: ReadonlyArray<StagedSlot | null> = [
      occupied,
      ...Array.from({ length: 29 }, () => null),
    ];
    const seeded: AppState = {
      kind: 'idle',
      staging: {
        slots,
        stagedMons: [],
        rightPaneSubview: 'staging',
        sessionMetadata: { createdAt: 'iso', lastModifiedAt: 'iso' },
      },
    };
    const action: Action = { type: 'source_clear' };
    const next = reducer(seeded, action);
    expect(next.staging?.slots).toBe(seeded.staging?.slots);
    void INITIAL_STATE; // suppress unused warning
  });
});
