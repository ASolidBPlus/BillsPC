/**
 * S8v2.2 — slot-addressed StagingStore unit tests.
 *
 * Covers the new `placeAt` / `removeAt` / `setPlacement` / `getSlot` /
 * `nextEmptySlot` / `isStaged` / `subscribeSlots` API surface, plus
 * the deprecated-shim contract (per AMEND-S8v2.2-2 / DECISION-S8v2.2-2:
 * legacy callers see the same StagingSessionV1 shape they always did).
 *
 * AMEND-S8v2.2-5 — `setPlacement` on an unoccupied slot REJECTS with a
 * descriptive error.
 */

import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';
import { StagingStore, deriveSourceRefKey } from '../cart/stagingStore.js';
import {
  STAGING_DB_NAME,
  STAGING_SLOT_COUNT,
  type StagedSlot,
} from '../cart/stagingStore.types.js';

let dbCounter = 0;
function nextDbName(): string {
  dbCounter++;
  return `${STAGING_DB_NAME}-slots-test-${dbCounter}`;
}

function payload(
  opts: Partial<Omit<StagedSlot, 'idx' | 'placement'>> & { slot: number },
): Omit<StagedSlot, 'idx' | 'placement'> {
  const cartLabel = opts.sourceCartLabel ?? 'POKEMON CRYSTAL (32 KB)';
  const tid = opts.sourceTid ?? 12345;
  const sourceRef = opts.sourceRef ?? { bucket: 'box' as const, boxIndex: 0, slot: opts.slot };
  return {
    pkBytes: opts.pkBytes ?? new Uint8Array([0xfe, 1, 2, 3]),
    speciesId: opts.speciesId ?? 158,
    nicknameDisplay: opts.nicknameDisplay ?? 'TOTODILE',
    sourceCartLabel: cartLabel,
    sourceTid: tid,
    sourceFamily: opts.sourceFamily ?? 'gen2',
    sourceOtName: opts.sourceOtName ?? 'JOEL',
    sourceRef,
    sourceRefKey: opts.sourceRefKey ?? deriveSourceRefKey(cartLabel, tid, sourceRef),
    stagedAt: opts.stagedAt ?? `2026-04-25T10:00:00.${opts.slot}Z`,
  };
}

describe('StagingStore — slot-addressed API (AMEND-S8v2.2-R1)', () => {
  it('placeAt populates the given slot index', async () => {
    const store = await StagingStore.open(nextDbName());
    await store.placeAt(0, payload({ slot: 0 }));
    expect(store.getSlot(0)?.speciesId).toBe(158);
    expect(store.getSlot(1)).toBeNull();
    expect(store.getAllSlots().length).toBe(STAGING_SLOT_COUNT);
    expect(store.nextEmptySlot()).toBe(1);
    store.close();
  });

  it('placeAt rejects on occupied slot', async () => {
    const store = await StagingStore.open(nextDbName());
    await store.placeAt(0, payload({ slot: 0 }));
    await expect(
      store.placeAt(0, payload({ slot: 1, sourceRef: { bucket: 'box', boxIndex: 0, slot: 1 } })),
    ).rejects.toThrow(/already occupied/);
    store.close();
  });

  it('placeAt rejects on sourceRefKey collision (de-dupe)', async () => {
    const store = await StagingStore.open(nextDbName());
    await store.placeAt(0, payload({ slot: 0 }));
    // Same sourceRef → derives same sourceRefKey; landing in a different
    // slot still rejects.
    await expect(store.placeAt(5, payload({ slot: 0 }))).rejects.toThrow(/already staged/);
    store.close();
  });

  it('removeAt clears the slot and frees nextEmptySlot', async () => {
    const store = await StagingStore.open(nextDbName());
    await store.placeAt(0, payload({ slot: 0 }));
    await store.placeAt(1, payload({ slot: 1, sourceRef: { bucket: 'box', boxIndex: 0, slot: 1 } }));
    await store.removeAt(0);
    expect(store.getSlot(0)).toBeNull();
    expect(store.nextEmptySlot()).toBe(0);
    expect(store.getSlot(1)?.speciesId).toBe(158);
    store.close();
  });

  it('setPlacement annotates the slot without removing it', async () => {
    const store = await StagingStore.open(nextDbName());
    await store.placeAt(0, payload({ slot: 0 }));
    await store.setPlacement(0, {
      destBoxIndex: 2,
      destSlot: 7,
      destCartLabel: 'POKEMON EMERALD',
      destTid: 99999,
      destFormat: 'rse',
    });
    const slot = store.getSlot(0);
    expect(slot).not.toBeNull();
    expect(slot?.placement?.destSlot).toBe(7);
    // removeAt still works for placed slots — used by the v2.3 commit
    // handler.
    await store.removeAt(0);
    expect(store.getSlot(0)).toBeNull();
    store.close();
  });

  it('setPlacement on an empty slot REJECTS (AMEND-S8v2.2-5)', async () => {
    const store = await StagingStore.open(nextDbName());
    await expect(
      store.setPlacement(5, {
        destBoxIndex: 0,
        destSlot: 0,
        destCartLabel: 'X',
        destTid: 1,
        destFormat: 'rse',
      }),
    ).rejects.toThrow(/slot 5 is empty/);
    store.close();
  });

  it('clear() empties all 30 slots', async () => {
    const store = await StagingStore.open(nextDbName());
    await store.placeAt(0, payload({ slot: 0 }));
    await store.placeAt(5, payload({ slot: 5, sourceRef: { bucket: 'box', boxIndex: 0, slot: 5 } }));
    await store.clear();
    expect(store.occupiedSlots()).toEqual([]);
    expect(store.getAllSlots().every((s) => s === null)).toBe(true);
    store.close();
  });

  it('isStaged returns true iff sourceRefKey matches an occupied slot', async () => {
    const store = await StagingStore.open(nextDbName());
    const ref = { bucket: 'box' as const, boxIndex: 0, slot: 3 };
    const key = deriveSourceRefKey('POKEMON CRYSTAL (32 KB)', 12345, ref);
    expect(store.isStaged(key)).toBe(false);
    await store.placeAt(0, payload({ slot: 3, sourceRef: ref, sourceRefKey: key }));
    expect(store.isStaged(key)).toBe(true);
    await store.removeAt(0);
    expect(store.isStaged(key)).toBe(false);
    store.close();
  });

  it('subscribeSlots fires immediately + on each mutation', async () => {
    const store = await StagingStore.open(nextDbName());
    const fires: number[] = [];
    const unsubscribe = store.subscribeSlots((snap) => {
      fires.push(snap.filter((s) => s !== null).length);
    });
    expect(fires).toEqual([0]);
    await store.placeAt(0, payload({ slot: 0 }));
    expect(fires).toEqual([0, 1]);
    await store.removeAt(0);
    expect(fires).toEqual([0, 1, 0]);
    unsubscribe();
    await store.placeAt(0, payload({ slot: 0 }));
    expect(fires).toEqual([0, 1, 0]);
    store.close();
  });

  it('IDB round-trip: open → place → close → open → placement visible', async () => {
    const dbName = nextDbName();
    const s1 = await StagingStore.open(dbName);
    await s1.placeAt(3, payload({ slot: 3, sourceRef: { bucket: 'box', boxIndex: 0, slot: 3 } }));
    s1.close();
    const s2 = await StagingStore.open(dbName);
    expect(s2.getSlot(3)?.speciesId).toBe(158);
    expect(s2.getSlot(0)).toBeNull();
    s2.close();
  });

  it('placeAt rejects on out-of-range idx', async () => {
    const store = await StagingStore.open(nextDbName());
    await expect(store.placeAt(-1, payload({ slot: 0 }))).rejects.toThrow(/out of range/);
    await expect(store.placeAt(30, payload({ slot: 0 }))).rejects.toThrow(/out of range/);
    store.close();
  });

  it('occupiedSlots returns slot-ordered array (not insertion order)', async () => {
    const store = await StagingStore.open(nextDbName());
    await store.placeAt(5, payload({ slot: 5, sourceRef: { bucket: 'box', boxIndex: 0, slot: 5 } }));
    await store.placeAt(2, payload({ slot: 2, sourceRef: { bucket: 'box', boxIndex: 0, slot: 2 } }));
    await store.placeAt(8, payload({ slot: 8, sourceRef: { bucket: 'box', boxIndex: 0, slot: 8 } }));
    const occupied = store.occupiedSlots();
    expect(occupied.map((s) => s.idx)).toEqual([2, 5, 8]);
  });
});

describe('StagingStore — deprecated shim (AMEND-S8v2.2-2)', () => {
  it('subscribe(legacy) fires with synthesized StagingSessionV1', async () => {
    const store = await StagingStore.open(nextDbName());
    const fires: number[] = [];
    type SessionLike = { schemaVersion: number; id: string; stagedMons: ReadonlyArray<unknown> };
    let lastSession: SessionLike | null = null;
    const unsubscribe = store.subscribe((s) => {
      fires.push(s.stagedMons.length);
      lastSession = s as SessionLike;
    });
    expect(fires).toEqual([0]);
    const ls = lastSession as SessionLike | null;
    expect(ls?.schemaVersion).toBe(1);
    expect(ls?.id).toBe('default');
    await store.placeAt(0, payload({ slot: 0 }));
    expect(fires).toEqual([0, 1]);
    const ls2 = lastSession as SessionLike | null;
    expect(ls2?.stagedMons.length).toBe(1);
    unsubscribe();
    store.close();
  });

  it('legacy stageMon places at next empty slot + de-dupes by sourceRef', async () => {
    const store = await StagingStore.open(nextDbName());
    await store.stageMon({
      pkBytes: new Uint8Array(80),
      sourceCartLabel: 'POKEMON CRYSTAL (32 KB)',
      sourceTid: 12345,
      sourceFamily: 'gen2',
      sourceOtName: 'JOEL',
      speciesId: 158,
      nicknameDisplay: 'TOTODILE',
      stagedAt: '2026-04-25T10:00:00Z',
      sourceRef: { bucket: 'box', boxIndex: 0, slot: 0 },
      destination: null,
    });
    expect(store.getSlot(0)?.speciesId).toBe(158);
    await expect(
      store.stageMon({
        pkBytes: new Uint8Array(80),
        sourceCartLabel: 'POKEMON CRYSTAL (32 KB)',
        sourceTid: 12345,
        sourceFamily: 'gen2',
        sourceOtName: 'JOEL',
        speciesId: 158,
        nicknameDisplay: 'TOTODILE',
        stagedAt: '2026-04-25T10:00:99Z',
        sourceRef: { bucket: 'box', boxIndex: 0, slot: 0 },
        destination: null,
      }),
    ).rejects.toThrow();
    store.close();
  });

  it('legacy unstageMon removes by stagedAt id', async () => {
    const store = await StagingStore.open(nextDbName());
    await store.placeAt(0, payload({ slot: 0, stagedAt: 'A' }));
    await store.placeAt(
      1,
      payload({ slot: 1, sourceRef: { bucket: 'box', boxIndex: 0, slot: 1 }, stagedAt: 'B' }),
    );
    await store.unstageMon('A');
    expect(store.getSlot(0)).toBeNull();
    expect(store.getSlot(1)?.stagedAt).toBe('B');
    store.close();
  });

  it('legacy setDestination maps 5-way enum → 2-way placement', async () => {
    const store = await StagingStore.open(nextDbName());
    await store.placeAt(0, payload({ slot: 0, stagedAt: 'A' }));
    await store.setDestination('A', {
      destCartLabel: 'POKEMON RUBY',
      destTid: 99999,
      destFormat: 'firered',
      destBoxIndex: 5,
      destSlot: 12,
    });
    expect(store.getSlot(0)?.placement?.destFormat).toBe('frlg');
    await store.setDestination('A', {
      destCartLabel: 'POKEMON RUBY',
      destTid: 99999,
      destFormat: 'emerald',
      destBoxIndex: 5,
      destSlot: 12,
    });
    expect(store.getSlot(0)?.placement?.destFormat).toBe('rse');
    store.close();
  });
});
