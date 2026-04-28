/**
 * S8v2.3 — `StagingStore.setSourceCommitted` API + cross-session
 * durability of the `sourceCommitted` flag.
 *
 * Asserts:
 *   * `placeAt` initialises slots with `sourceCommitted: false`.
 *   * `setSourceCommitted(idx, true)` flips the flag, emits a
 *     subscribeSlots event, and persists in IDB.
 *   * Throws when the target slot is empty (loud failure beats silent).
 *   * Cross-session durability — close the store, reopen against the
 *     same DB name, and the flag is still set on the slot.
 *   * Other slot fields (`pkBytes`, `speciesId`, `placement`, etc.)
 *     are preserved across the flip.
 */

import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';
import { StagingStore, deriveSourceRefKey } from '../cart/stagingStore.js';
import {
  STAGING_DB_NAME,
  type StagedSlot,
} from '../cart/stagingStore.types.js';

let dbCounter = 0;
function nextDbName(): string {
  dbCounter++;
  return `${STAGING_DB_NAME}-srccommit-${dbCounter}`;
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

describe('StagingStore.setSourceCommitted (S8v2.3)', () => {
  it('placeAt initialises sourceCommitted to false', async () => {
    const store = await StagingStore.open(nextDbName());
    await store.placeAt(0, payload(0));
    const slot = store.getSlot(0);
    expect(slot).not.toBeNull();
    expect(slot?.sourceCommitted).toBe(false);
    store.close();
  });

  it('setSourceCommitted(idx, true) flips the flag + fires subscribe', async () => {
    const store = await StagingStore.open(nextDbName());
    await store.placeAt(0, payload(0));
    const events: Array<ReadonlyArray<StagedSlot | null>> = [];
    const unsub = store.subscribeSlots((s) => events.push(s));
    // Capture only post-mutation events: the initial subscribe fires
    // synchronously with the current snapshot, so events[0] is the
    // pre-flip state. We assert events.length grew by 1 after the call.
    const before = events.length;
    await store.setSourceCommitted(0, true);
    expect(events.length).toBe(before + 1);
    const flipped = events[events.length - 1]![0];
    expect(flipped?.sourceCommitted).toBe(true);
    unsub();
    store.close();
  });

  it('preserves other slot fields when flipping the flag', async () => {
    const store = await StagingStore.open(nextDbName());
    await store.placeAt(3, payload(3));
    const before = store.getSlot(3)!;
    await store.setSourceCommitted(3, true);
    const after = store.getSlot(3)!;
    expect(after.pkBytes).toEqual(before.pkBytes);
    expect(after.speciesId).toBe(before.speciesId);
    expect(after.nicknameDisplay).toBe(before.nicknameDisplay);
    expect(after.sourceRefKey).toBe(before.sourceRefKey);
    expect(after.placement).toBe(before.placement);
    expect(after.sourceCommitted).toBe(true);
  });

  it('throws when the target slot is empty', async () => {
    const store = await StagingStore.open(nextDbName());
    await expect(store.setSourceCommitted(5, true)).rejects.toThrow(/slot 5 is empty/);
    store.close();
  });

  it('cross-session durability: close + reopen preserves sourceCommitted: true', async () => {
    const dbName = nextDbName();
    const a = await StagingStore.open(dbName);
    await a.placeAt(0, payload(0));
    await a.placeAt(1, payload(1));
    await a.setSourceCommitted(0, true);
    a.close();

    // Reopen against the SAME db. Both slots survive; slot 0 is still
    // source-committed, slot 1 is not.
    const b = await StagingStore.open(dbName);
    const slot0 = b.getSlot(0);
    const slot1 = b.getSlot(1);
    expect(slot0).not.toBeNull();
    expect(slot1).not.toBeNull();
    expect(slot0?.sourceCommitted).toBe(true);
    // Slot 1 must default-read as false (additive IDB field).
    expect(slot1?.sourceCommitted ?? false).toBe(false);
    b.close();
  });
});
