/**
 * S7b — `StagingStore` tests. Uses `fake-indexeddb` to provide an
 * IndexedDB shim under jsdom + node.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { StagingStore } from '../cart/stagingStore.js';
import { STAGING_DB_NAME, type StagedMon } from '../cart/stagingStore.types.js';

function mon(opts: Partial<StagedMon> & { stagedAt: string; slot: number }): StagedMon {
  return {
    pkBytes: new Uint8Array([1, 2, 3, 4]),
    sourceCartLabel: 'POKEMON CRYSTAL (32 KB)',
    sourceTid: 12345,
    sourceFamily: 'gen2',
    sourceOtName: 'JOEL',
    speciesId: 158,
    nicknameDisplay: 'TOTODILE',
    sourceRef: { bucket: 'box', boxIndex: 0, slot: opts.slot },
    destination: null,
    ...opts,
  } as StagedMon;
}

let dbCounter = 0;
function nextDbName(): string {
  dbCounter++;
  return `${STAGING_DB_NAME}-test-${dbCounter}`;
}

describe('StagingStore', () => {
  beforeAll(() => {
    // fake-indexeddb/auto sets globalThis.indexedDB; nothing more to do.
  });

  beforeEach(() => {
    // Each test gets a fresh DB name to avoid cross-pollution.
  });

  it('opens an empty session when the DB is fresh', async () => {
    const store = await StagingStore.open(nextDbName());
    const session = store.load();
    expect(session.schemaVersion).toBe(1);
    expect(session.id).toBe('default');
    expect(session.stagedMons).toEqual([]);
    store.close();
  });

  it('stages 3 mons; load returns all 3 with bytes intact', async () => {
    const store = await StagingStore.open(nextDbName());
    await store.stageMon(mon({ stagedAt: '2026-04-23T10:00:00Z', slot: 0 }));
    await store.stageMon(mon({ stagedAt: '2026-04-23T10:00:01Z', slot: 1 }));
    await store.stageMon(mon({ stagedAt: '2026-04-23T10:00:02Z', slot: 2 }));
    const session = store.load();
    expect(session.stagedMons.length).toBe(3);
    expect(Array.from(session.stagedMons[0]!.pkBytes)).toEqual([1, 2, 3, 4]);
    store.close();
  });

  it('refuses to stage a mon whose sourceRef matches an existing entry', async () => {
    const store = await StagingStore.open(nextDbName());
    await store.stageMon(mon({ stagedAt: '2026-04-23T10:00:00Z', slot: 0 }));
    await expect(
      store.stageMon(mon({ stagedAt: '2026-04-23T10:00:99Z', slot: 0 })),
    ).rejects.toThrow();
    store.close();
  });

  it('setDestination updates the staged mon and returns updated session', async () => {
    const store = await StagingStore.open(nextDbName());
    await store.stageMon(mon({ stagedAt: '2026-04-23T10:00:00Z', slot: 0 }));
    await store.setDestination('2026-04-23T10:00:00Z', {
      destCartLabel: 'POKEMON RUBY (128 KB)',
      destTid: 99999,
      destFormat: 'ruby',
      destBoxIndex: 5,
      destSlot: 12,
    });
    const session = store.load();
    expect(session.stagedMons[0]!.destination!.destBoxIndex).toBe(5);
    store.close();
  });

  it('clear() empties the session but keeps schemaVersion 1', async () => {
    const store = await StagingStore.open(nextDbName());
    await store.stageMon(mon({ stagedAt: '2026-04-23T10:00:00Z', slot: 0 }));
    await store.clear();
    const session = store.load();
    expect(session.stagedMons).toEqual([]);
    expect(session.schemaVersion).toBe(1);
    store.close();
  });

  it('subscribe fires immediately with the current session, then on each mutation', async () => {
    const store = await StagingStore.open(nextDbName());
    const fires: number[] = [];
    const unsubscribe = store.subscribe((s) => fires.push(s.stagedMons.length));
    expect(fires).toEqual([0]);
    await store.stageMon(mon({ stagedAt: '2026-04-23T10:00:00Z', slot: 0 }));
    expect(fires).toEqual([0, 1]);
    unsubscribe();
    await store.stageMon(mon({ stagedAt: '2026-04-23T10:00:01Z', slot: 1 }));
    expect(fires).toEqual([0, 1]);
    store.close();
  });

  it('persists across re-open (simulated reload)', async () => {
    const dbName = nextDbName();
    const store1 = await StagingStore.open(dbName);
    await store1.stageMon(mon({ stagedAt: '2026-04-23T10:00:00Z', slot: 0 }));
    await store1.stageMon(mon({ stagedAt: '2026-04-23T10:00:01Z', slot: 1 }));
    store1.close();
    const store2 = await StagingStore.open(dbName);
    const session = store2.load();
    expect(session.stagedMons.length).toBe(2);
    store2.close();
  });

  it('unstageMon removes by stagedAt id', async () => {
    const store = await StagingStore.open(nextDbName());
    await store.stageMon(mon({ stagedAt: '2026-04-23T10:00:00Z', slot: 0 }));
    await store.stageMon(mon({ stagedAt: '2026-04-23T10:00:01Z', slot: 1 }));
    await store.unstageMon('2026-04-23T10:00:00Z');
    const session = store.load();
    expect(session.stagedMons.length).toBe(1);
    expect(session.stagedMons[0]!.stagedAt).toBe('2026-04-23T10:00:01Z');
    store.close();
  });
});
