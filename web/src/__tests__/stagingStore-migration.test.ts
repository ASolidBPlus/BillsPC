/**
 * S8v2.2 — IDB v1 → v2 migration tests (per AMEND-S8v2.2-4 / -9).
 *
 * Each test seeds an IDB store directly (under a fresh dbName) with a
 * v1-shaped session record (`{ schemaVersion: 1, stagedMons: [...] }`),
 * then opens StagingStore and asserts the migrated v2 shape.
 *
 * Edge cases covered:
 *   * happy path — N entries (≤30) migrate to slots[0..N-1]
 *   * overflow — >30 entries → first 30 land, rest dropped, surfaced
 *     via `pendingMigrationOverflow`
 *   * corrupted entry — missing pkBytes → skipped + console.error
 *   * destFormat 5-way → 2-way mapping
 *   * legacy subscribe(callback) post-migration emits StagingSessionV1
 */

import { describe, it, expect, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { StagingStore } from '../cart/stagingStore.js';
import {
  STAGING_DB_NAME,
  STAGING_OBJECT_STORE,
  STAGING_DEFAULT_ID,
  type StagedMon,
} from '../cart/stagingStore.types.js';

let dbCounter = 0;
function nextDbName(): string {
  dbCounter++;
  return `${STAGING_DB_NAME}-mig-test-${dbCounter}`;
}

function v1Mon(slot: number, opts: Partial<StagedMon> = {}): StagedMon {
  return {
    pkBytes: new Uint8Array([1, 2, 3, 4]),
    sourceCartLabel: 'POKEMON CRYSTAL (32 KB)',
    sourceTid: 12345,
    sourceFamily: 'gen2',
    sourceOtName: 'JOEL',
    speciesId: 158 + slot,
    nicknameDisplay: 'TOTODILE',
    stagedAt: `2026-04-25T10:00:00.${slot}Z`,
    sourceRef: { bucket: 'box', boxIndex: 0, slot },
    destination: null,
    ...opts,
  };
}

async function seedV1(dbName: string, mons: ReadonlyArray<StagedMon>): Promise<void> {
  // Open IDB directly (avoid going through StagingStore so we can write
  // the legacy shape).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const idb = (globalThis as any).indexedDB as IDBFactory;
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = idb.open(dbName, 1);
    req.onupgradeneeded = (): void => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STAGING_OBJECT_STORE)) {
        d.createObjectStore(STAGING_OBJECT_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = (): void => resolve(req.result);
    req.onerror = (): void => reject(req.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STAGING_OBJECT_STORE, 'readwrite');
    const store = tx.objectStore(STAGING_OBJECT_STORE);
    store.put({
      schemaVersion: 1,
      id: STAGING_DEFAULT_ID,
      stagedMons: mons,
      sessionMetadata: {
        createdAt: '2026-04-20T00:00:00Z',
        lastModifiedAt: '2026-04-25T00:00:00Z',
      },
    });
    tx.oncomplete = (): void => resolve();
    tx.onerror = (): void => reject(tx.error);
  });
  db.close();
}

describe('StagingStore IDB v1→v2 migration', () => {
  it('migrates a 3-mon v1 session into slots[0..2]', async () => {
    const dbName = nextDbName();
    await seedV1(dbName, [v1Mon(0), v1Mon(1), v1Mon(2)]);
    const store = await StagingStore.open(dbName);
    expect(store.getSlot(0)?.idx).toBe(0);
    expect(store.getSlot(0)?.speciesId).toBe(158);
    expect(store.getSlot(2)?.speciesId).toBe(160);
    expect(store.getSlot(3)).toBeNull();
    expect(store.pendingMigrationOverflow).toBe(0);
    store.close();
  });

  it('drops entries past slot 29 and surfaces pendingMigrationOverflow', async () => {
    const dbName = nextDbName();
    const mons = Array.from({ length: 32 }, (_, i) => v1Mon(i));
    await seedV1(dbName, mons);
    const store = await StagingStore.open(dbName);
    expect(store.pendingMigrationOverflow).toBe(2);
    expect(store.occupiedSlots().length).toBe(30);
    expect(store.getSlot(29)).not.toBeNull();
    store.close();
  });

  it('skips corrupted entries and logs console.error', async () => {
    const dbName = nextDbName();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // Second entry is corrupted (missing pkBytes).
    const mons: ReadonlyArray<StagedMon> = [
      v1Mon(0),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ...(v1Mon(1) as any), pkBytes: undefined },
      v1Mon(2),
    ];
    await seedV1(dbName, mons);
    const store = await StagingStore.open(dbName);
    expect(store.occupiedSlots().length).toBe(2);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
    store.close();
  });

  it('maps legacy destFormat: emerald → rse, firered → frlg', async () => {
    const dbName = nextDbName();
    const a = v1Mon(0, {
      destination: {
        destCartLabel: 'X',
        destTid: 1,
        destFormat: 'emerald',
        destBoxIndex: 0,
        destSlot: 0,
      },
    });
    const b = v1Mon(1, {
      destination: {
        destCartLabel: 'Y',
        destTid: 2,
        destFormat: 'firered',
        destBoxIndex: 0,
        destSlot: 0,
      },
    });
    await seedV1(dbName, [a, b]);
    const store = await StagingStore.open(dbName);
    expect(store.getSlot(0)?.placement?.destFormat).toBe('rse');
    expect(store.getSlot(1)?.placement?.destFormat).toBe('frlg');
    store.close();
  });

  it('persists migrated v2 shape — second open() does NOT re-migrate', async () => {
    const dbName = nextDbName();
    await seedV1(dbName, [v1Mon(0), v1Mon(1)]);
    const s1 = await StagingStore.open(dbName);
    expect(s1.occupiedSlots().length).toBe(2);
    s1.close();
    const s2 = await StagingStore.open(dbName);
    expect(s2.pendingMigrationOverflow).toBe(0);
    expect(s2.occupiedSlots().length).toBe(2);
    s2.close();
  });

  it('legacy subscribe() post-migration emits StagingSessionV1 shape', async () => {
    const dbName = nextDbName();
    await seedV1(dbName, [v1Mon(0)]);
    const store = await StagingStore.open(dbName);
    type SessionLike = { schemaVersion: number; stagedMons: ReadonlyArray<unknown> };
    let lastSession: SessionLike | null = null;
    const unsubscribe = store.subscribe((s) => {
      lastSession = s as SessionLike;
    });
    const ls = lastSession as SessionLike | null;
    expect(ls?.schemaVersion).toBe(1);
    expect(ls?.stagedMons.length).toBe(1);
    unsubscribe();
    store.close();
  });

  it('handles an empty IDB (no record) — fresh init, no overflow', async () => {
    const dbName = nextDbName();
    const store = await StagingStore.open(dbName);
    expect(store.pendingMigrationOverflow).toBe(0);
    expect(store.occupiedSlots()).toEqual([]);
    store.close();
  });
});
