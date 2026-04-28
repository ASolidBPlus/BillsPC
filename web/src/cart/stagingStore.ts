/**
 * IndexedDB-backed persistent staging box.
 *
 * S8v2.2 — REWRITTEN to a slot-addressed 30-slot model per
 * AMEND-S8v2.2-R1. Mons live AT a specific slot index (0..29); the
 * session schema in IDB is `StagingSessionV2 = { slots: Array<...>(30) }`.
 *
 * Old S7b methods (`stageMon` / `unstageMon` / `setDestination` /
 * `subscribe(legacyListener)`) survive as `@deprecated` shims — see
 * AMEND-S8v2.2-2. The legacy `stagingPane.ts` UI keeps working
 * unchanged through these shims.
 *
 * Migration: structural detection per AMEND-S8v2.2-4. If the IDB has a
 * v1-shaped `{ stagedMons: [...] }` record, we copy each entry into
 * `slots[i]`, dropping anything past index 29 and surfacing the drop
 * count via `pendingMigrationOverflow` (consumed by `createController`
 * to dispatch a banner action — AMEND-S8v2.2-9).
 *
 * Per AMEND-S7b-18: a `BroadcastChannel('pokeportal-staging')` posts a
 * `staging-claim` on `open`; other tabs respond with `staging-already-open`.
 * The UI shows a "another tab has the staging box" banner via the
 * `subscribeMultiTab` callback.
 *
 * KNOWN LIMITATION (per DECISION-S8v2.2-9): IndexedDB does NOT auto-fire
 * update events across tabs. `subscribe()` only fires for mutations made
 * through THIS tab's `StagingStore` instance. Cross-tab UPDATE sync
 * (one tab adds a mon → other tabs re-render their snapshot) is out of
 * scope for v2.2 — the multi-tab banner is the user-visible signal.
 */

import {
  STAGING_BROADCAST_CHANNEL,
  STAGING_DB_NAME,
  STAGING_DEFAULT_ID,
  STAGING_OBJECT_STORE,
  STAGING_SLOT_COUNT,
  type StagedMon,
  type StagedMonDestinationGen3,
  type StagedSlot,
  type StagedPlacement,
  type StagingSessionV1,
  type StagingSessionV2,
  type StagingSnapshot,
} from './stagingStore.types.js';

/** Legacy callback shape (synthesizes a `StagingSessionV1`). */
export type StagingListener = (session: StagingSessionV1) => void;

/** New slot-addressed callback shape — used by v2.2+ consumers. */
export type StagingSnapshotListener = (snapshot: StagingSnapshot) => void;

export interface StagingMultiTabEvent {
  readonly kind: 'another-tab-claimed';
}

export type StagingMultiTabListener = (event: StagingMultiTabEvent) => void;

interface BroadcastChannelLike {
  postMessage(msg: unknown): void;
  close(): void;
  onmessage: ((ev: MessageEvent) => void) | null;
}

interface BroadcastChannelCtor {
  new (name: string): BroadcastChannelLike;
}

function emptySlots(): Array<StagedSlot | null> {
  return Array.from({ length: STAGING_SLOT_COUNT }, () => null);
}

function indexedDb(): IDBFactory | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  return (g.indexedDB as IDBFactory | undefined) ?? null;
}

function broadcastChannelCtor(): BroadcastChannelCtor | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  return (g.BroadcastChannel as BroadcastChannelCtor | undefined) ?? null;
}

async function openDb(dbName: string): Promise<IDBDatabase> {
  const idb = indexedDb();
  if (!idb) throw new Error('StagingStore: IndexedDB is not available in this environment');
  return new Promise((resolve, reject) => {
    // AMEND-S8v2.2-4 — DO NOT bump the IDB schema version. Migration
    // happens on the Promise side after `get`; the IDB layout itself
    // (object store name + key path) is unchanged.
    const req = idb.open(dbName, 1);
    req.onupgradeneeded = (): void => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STAGING_OBJECT_STORE)) {
        db.createObjectStore(STAGING_OBJECT_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = (): void => resolve(req.result);
    req.onerror = (): void => reject(req.error);
  });
}

/** Raw IDB read — returns whatever shape the store contains, or null. */
async function txGetRaw(db: IDBDatabase): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STAGING_OBJECT_STORE, 'readonly');
    const store = tx.objectStore(STAGING_OBJECT_STORE);
    const req = store.get(STAGING_DEFAULT_ID);
    req.onsuccess = (): void => resolve(req.result ?? null);
    req.onerror = (): void => reject(req.error);
  });
}

async function txPutSession(db: IDBDatabase, session: StagingSessionV2): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STAGING_OBJECT_STORE, 'readwrite');
    const store = tx.objectStore(STAGING_OBJECT_STORE);
    store.put(session);
    tx.oncomplete = (): void => resolve();
    tx.onerror = (): void => reject(tx.error);
    tx.onabort = (): void => reject(tx.error);
  });
}

/**
 * Per CLAR-7 — canonical sourceRefKey derivation. Exported so the
 * v2.2 add-to-transfer handler can derive the same key without
 * re-importing the old internal closure.
 */
export function deriveSourceRefKey(
  cartLabel: string,
  tid: number,
  ref: { bucket: 'party' | 'currentBox' | 'box'; boxIndex?: number; slot: number },
): string {
  if (ref.bucket === 'box') {
    return `${cartLabel}|${tid}|box:${ref.boxIndex ?? 0}:${ref.slot}`;
  }
  return `${cartLabel}|${tid}|${ref.bucket}:${ref.slot}`;
}

/**
 * AMEND-S8v2.2-2 — adapt a slot record to the legacy `StagedMon` shape
 * for the deprecated subscribe path. `placement.destFormat` (the
 * collapsed 2-way enum) is mapped back to a representative legacy
 * 5-way value — `'rse' → 'emerald'`, `'frlg' → 'firered'` — so legacy
 * consumers see a well-typed `StagedMon.destination`.
 *
 * The choice is arbitrary but DETERMINISTIC; legacy code that branches
 * on the specific game id (e.g. `'ruby'` vs `'sapphire'`) was already
 * lossy under the v2.2 model since the new schema doesn't preserve it.
 */
export function slotToLegacyMon(slot: StagedSlot): StagedMon {
  let destination: StagedMonDestinationGen3 | null = null;
  if (slot.placement) {
    const destFormat: StagedMonDestinationGen3['destFormat'] =
      slot.placement.destFormat === 'frlg' ? 'firered' : 'emerald';
    destination = {
      destCartLabel: slot.placement.destCartLabel,
      destTid: slot.placement.destTid,
      destFormat,
      destBoxIndex: slot.placement.destBoxIndex,
      destSlot: slot.placement.destSlot,
    };
  }
  return {
    pkBytes: slot.pkBytes,
    sourceCartLabel: slot.sourceCartLabel,
    sourceTid: slot.sourceTid,
    sourceFamily: slot.sourceFamily,
    sourceOtName: slot.sourceOtName,
    speciesId: slot.speciesId,
    nicknameDisplay: slot.nicknameDisplay,
    stagedAt: slot.stagedAt,
    sourceRef: slot.sourceRef,
    destination,
  };
}

/**
 * AMEND-S8v2.2-4 / AMEND-S8v2.2-9 — migrate a v1-shaped session to v2.
 * Drops entries past slot 29 and surfaces the count in `dropped`.
 * Skips corrupted entries (missing `pkBytes`) and logs them.
 */
function migrateV1ToV2(v1: StagingSessionV1): {
  slots: Array<StagedSlot | null>;
  dropped: number;
  skipped: number;
} {
  const slots = emptySlots();
  let dropped = 0;
  let skipped = 0;
  let nextIdx = 0;
  for (let i = 0; i < v1.stagedMons.length; i++) {
    const m = v1.stagedMons[i];
    // The `instanceof Uint8Array` check would reject IDB-structured-cloned
    // bytes (fake-indexeddb / different realm). Use a duck-type check
    // against the array-like surface instead — accepts both real
    // Uint8Array and IDB-roundtripped equivalents.
    const looksLikeBytes =
      m && m.pkBytes && typeof (m.pkBytes as ArrayLike<number>).length === 'number';
    if (
      !m ||
      !looksLikeBytes ||
      typeof m.sourceCartLabel !== 'string' ||
      typeof m.sourceTid !== 'number' ||
      !m.sourceRef
    ) {
      // Don't crash open(). Per AMEND-S8v2.2-4 just skip + log.
      console.error('staging migration: skipped corrupt entry', i);
      skipped += 1;
      continue;
    }
    // Normalize bytes to a Uint8Array so downstream consumers don't
    // need to care about the source realm.
    const pkBytes =
      m.pkBytes instanceof Uint8Array ? m.pkBytes : new Uint8Array(m.pkBytes as ArrayLike<number>);
    if (nextIdx >= STAGING_SLOT_COUNT) {
      dropped += 1;
      continue;
    }
    const sourceRefKey = deriveSourceRefKey(m.sourceCartLabel, m.sourceTid, m.sourceRef);
    let placement: StagedPlacement | null = null;
    if (m.destination) {
      // Legacy 5-way → v2 2-way per AMEND-S8v2.2-4 mapping.
      const fmt: 'frlg' | 'rse' =
        m.destination.destFormat === 'firered' || m.destination.destFormat === 'leafgreen'
          ? 'frlg'
          : 'rse';
      placement = {
        destBoxIndex: m.destination.destBoxIndex,
        destSlot: m.destination.destSlot,
        destCartLabel: m.destination.destCartLabel,
        destTid: m.destination.destTid,
        destFormat: fmt,
      };
    }
    const slot: StagedSlot = {
      idx: nextIdx,
      pkBytes,
      speciesId: m.speciesId,
      nicknameDisplay: m.nicknameDisplay,
      sourceCartLabel: m.sourceCartLabel,
      sourceTid: m.sourceTid,
      sourceFamily: m.sourceFamily,
      sourceOtName: m.sourceOtName,
      sourceRef: m.sourceRef,
      sourceRefKey,
      stagedAt: m.stagedAt,
      placement,
    };
    slots[nextIdx] = slot;
    nextIdx += 1;
  }
  return { slots, dropped, skipped };
}

export class StagingStore {
  /** Slot-addressed listeners — v2.2+ consumers. */
  private readonly slotListeners: Set<StagingSnapshotListener> = new Set();
  /** Legacy session listeners (deprecated shim path). */
  private readonly legacyListeners: Set<StagingListener> = new Set();
  private readonly multiTabListeners: Set<StagingMultiTabListener> = new Set();
  private slots: Array<StagedSlot | null>;
  private channel: BroadcastChannelLike | null = null;
  private readonly createdAt: string;
  private lastMutationISO: string;
  /**
   * AMEND-S8v2.2-9 — non-zero when the v1→v2 migration dropped entries.
   * The controller reads this once after `open()` and dispatches the
   * `staging_migration_overflow` action. Cleared after read so a
   * repeated read doesn't double-fire.
   */
  pendingMigrationOverflow: number = 0;

  private constructor(
    private readonly db: IDBDatabase,
    initialSlots: Array<StagedSlot | null>,
    createdAt: string,
    private readonly dbName: string,
  ) {
    this.slots = initialSlots;
    this.createdAt = createdAt;
    this.lastMutationISO = createdAt;
    void this.dbName;
  }

  static async open(dbName: string = STAGING_DB_NAME): Promise<StagingStore> {
    const db = await openDb(dbName);
    const raw = (await txGetRaw(db)) as
      | StagingSessionV2
      | StagingSessionV1
      | { schemaVersion?: number; id?: string }
      | null;

    let slots: Array<StagedSlot | null>;
    let createdAt: string;
    let pendingOverflow = 0;
    let needsRewrite = false;

    if (
      raw &&
      typeof raw === 'object' &&
      'slots' in raw &&
      Array.isArray((raw as StagingSessionV2).slots)
    ) {
      const v2 = raw as StagingSessionV2;
      // Defensive: pad/truncate to exactly 30 slots in case persisted
      // shape ever drifts (e.g. test fixture seeded a shorter array).
      slots = emptySlots();
      for (let i = 0; i < Math.min(v2.slots.length, STAGING_SLOT_COUNT); i++) {
        slots[i] = v2.slots[i] ?? null;
      }
      createdAt = v2.sessionMetadata?.createdAt ?? new Date().toISOString();
    } else if (
      raw &&
      typeof raw === 'object' &&
      'stagedMons' in raw &&
      Array.isArray((raw as StagingSessionV1).stagedMons)
    ) {
      // AMEND-S8v2.2-4 — migrate v1 → v2 structurally.
      const v1 = raw as StagingSessionV1;
      const migrated = migrateV1ToV2(v1);
      slots = migrated.slots;
      pendingOverflow = migrated.dropped;
      createdAt = v1.sessionMetadata?.createdAt ?? new Date().toISOString();
      needsRewrite = true;
    } else {
      // Empty or unrecognized — initialize fresh.
      slots = emptySlots();
      createdAt = new Date().toISOString();
    }

    const store = new StagingStore(db, slots, createdAt, dbName);
    store.pendingMigrationOverflow = pendingOverflow;
    if (needsRewrite) {
      // Persist the migrated shape so the next open() doesn't re-migrate.
      await txPutSession(db, store.buildSessionV2());
    }
    store.attachBroadcast();
    return store;
  }

  /** v2.2+ — synchronous read of the slot-addressed snapshot. */
  getAllSlots(): ReadonlyArray<StagedSlot | null> {
    return this.slots.slice();
  }

  getSlot(idx: number): StagedSlot | null {
    if (idx < 0 || idx >= STAGING_SLOT_COUNT) return null;
    return this.slots[idx] ?? null;
  }

  occupiedSlots(): ReadonlyArray<StagedSlot> {
    const out: StagedSlot[] = [];
    for (const s of this.slots) {
      if (s !== null) out.push(s);
    }
    return out;
  }

  nextEmptySlot(): number | null {
    for (let i = 0; i < STAGING_SLOT_COUNT; i++) {
      if (this.slots[i] === null) return i;
    }
    return null;
  }

  isStaged(sourceRefKey: string): boolean {
    for (const s of this.slots) {
      if (s !== null && s.sourceRefKey === sourceRefKey) return true;
    }
    return false;
  }

  /**
   * Place a mon at the given slot. Throws if `idx` is occupied or if
   * `mon.sourceRefKey` matches any existing occupied slot's
   * `sourceRefKey` (de-dupe). Per Generator pre-flight #1.
   */
  async placeAt(idx: number, mon: Omit<StagedSlot, 'idx' | 'placement'>): Promise<void> {
    if (idx < 0 || idx >= STAGING_SLOT_COUNT) {
      throw new Error(`StagingStore.placeAt: idx ${idx} out of range`);
    }
    if (this.slots[idx] !== null) {
      throw new Error(`StagingStore.placeAt: slot ${idx} already occupied`);
    }
    for (const s of this.slots) {
      if (s !== null && s.sourceRefKey === mon.sourceRefKey) {
        throw new Error(
          `StagingStore.placeAt: sourceRefKey ${mon.sourceRefKey} already staged or source-committed`,
        );
      }
    }
    const placed: StagedSlot = { ...mon, idx, placement: null, sourceCommitted: false };
    const next = this.slots.slice();
    next[idx] = placed;
    this.slots = next;
    this.lastMutationISO = new Date().toISOString();
    await txPutSession(this.db, this.buildSessionV2());
    this.fire();
  }

  async removeAt(idx: number): Promise<void> {
    if (idx < 0 || idx >= STAGING_SLOT_COUNT) return;
    if (this.slots[idx] === null) return;
    const next = this.slots.slice();
    next[idx] = null;
    this.slots = next;
    this.lastMutationISO = new Date().toISOString();
    await txPutSession(this.db, this.buildSessionV2());
    this.fire();
  }

  /**
   * AMEND-S8v2.2-5 — `setPlacement` on an unoccupied slot THROWS.
   * The v2.2 add-to-dest handler should never target an empty
   * transfer slot; loud failure beats silent.
   */
  async setPlacement(idx: number, placement: StagedPlacement | null): Promise<void> {
    if (idx < 0 || idx >= STAGING_SLOT_COUNT) {
      throw new Error(`StagingStore.setPlacement: idx ${idx} out of range`);
    }
    const cur = this.slots[idx];
    if (cur === null || cur === undefined) {
      throw new Error(`StagingStore.setPlacement: slot ${idx} is empty`);
    }
    const next = this.slots.slice();
    next[idx] = { ...cur, placement };
    this.slots = next;
    this.lastMutationISO = new Date().toISOString();
    await txPutSession(this.db, this.buildSessionV2());
    this.fire();
  }

  /**
   * v2.3 — flip the `sourceCommitted` flag on an occupied slot. Throws
   * when the slot is empty (caller must filter first). Persists in IDB
   * (additive field — old records read back default `sourceCommitted:
   * false` per the IDB shape comment in this file).
   */
  async setSourceCommitted(idx: number, value: boolean): Promise<void> {
    if (idx < 0 || idx >= STAGING_SLOT_COUNT) {
      throw new Error(`StagingStore.setSourceCommitted: idx ${idx} out of range`);
    }
    const cur = this.slots[idx];
    if (cur === null || cur === undefined) {
      throw new Error(`StagingStore.setSourceCommitted: slot ${idx} is empty`);
    }
    const next = this.slots.slice();
    next[idx] = { ...cur, sourceCommitted: value };
    this.slots = next;
    this.lastMutationISO = new Date().toISOString();
    await txPutSession(this.db, this.buildSessionV2());
    this.fire();
  }

  async clear(): Promise<void> {
    this.slots = emptySlots();
    this.lastMutationISO = new Date().toISOString();
    await txPutSession(this.db, this.buildSessionV2());
    this.fire();
  }

  /**
   * Legacy subscribe — synthesizes a `StagingSessionV1` per AMEND-S8v2.2-2.
   * Fires immediately with the current snapshot, then on every mutation.
   */
  subscribe(listener: StagingListener): () => void {
    this.legacyListeners.add(listener);
    listener(this.buildSessionV1());
    return () => this.legacyListeners.delete(listener);
  }

  /**
   * v2.2+ slot-addressed subscribe. Fires immediately with the current
   * snapshot, then on every mutation. The snapshot is a fresh array
   * each time so consumers can do reference-equality diffing.
   */
  subscribeSlots(listener: StagingSnapshotListener): () => void {
    this.slotListeners.add(listener);
    listener(this.slots.slice());
    return () => this.slotListeners.delete(listener);
  }

  subscribeMultiTab(listener: StagingMultiTabListener): () => void {
    this.multiTabListeners.add(listener);
    return () => this.multiTabListeners.delete(listener);
  }

  /** For test cleanup. Closes the IDB handle + BroadcastChannel. */
  close(): void {
    this.legacyListeners.clear();
    this.slotListeners.clear();
    this.multiTabListeners.clear();
    if (this.channel) {
      try {
        this.channel.close();
      } catch {
        /* ignore */
      }
      this.channel = null;
    }
    try {
      this.db.close();
    } catch {
      /* ignore */
    }
  }

  // -------------------------------------------------------------------
  // Deprecated S7b shims — preserved for legacy `stagingPane.ts` and
  // `cartFlasher` consumers. New code uses the slot-addressed API.
  // -------------------------------------------------------------------

  /**
   * @deprecated v2-cleanup candidate — new code should call `placeAt`.
   *
   * The shim places `mon` at the next empty slot. Throws "no empty slot"
   * when the box is full; throws on `sourceRefKey` collision (matches
   * the old contract per Risk #8 / DECISION-S8v2.2-2).
   */
  async stageMon(mon: StagedMon): Promise<void> {
    const idx = this.nextEmptySlot();
    if (idx === null) {
      throw new Error('stagingStore.stageMon: no empty slot');
    }
    const sourceRefKey = deriveSourceRefKey(mon.sourceCartLabel, mon.sourceTid, mon.sourceRef);
    if (this.isStaged(sourceRefKey)) {
      throw new Error(`stagingStore.stageMon: ref ${sourceRefKey} already staged`);
    }
    await this.placeAt(idx, {
      pkBytes: mon.pkBytes,
      speciesId: mon.speciesId,
      nicknameDisplay: mon.nicknameDisplay,
      sourceCartLabel: mon.sourceCartLabel,
      sourceTid: mon.sourceTid,
      sourceFamily: mon.sourceFamily,
      sourceOtName: mon.sourceOtName,
      sourceRef: mon.sourceRef,
      sourceRefKey,
      stagedAt: mon.stagedAt,
    });
    if (mon.destination) {
      // Preserve the legacy "stage with destination already set" flow.
      const fmt: 'frlg' | 'rse' =
        mon.destination.destFormat === 'firered' || mon.destination.destFormat === 'leafgreen'
          ? 'frlg'
          : 'rse';
      await this.setPlacement(idx, {
        destBoxIndex: mon.destination.destBoxIndex,
        destSlot: mon.destination.destSlot,
        destCartLabel: mon.destination.destCartLabel,
        destTid: mon.destination.destTid,
        destFormat: fmt,
      });
    }
  }

  /**
   * @deprecated v2-cleanup candidate — new code should call `removeAt`.
   */
  async unstageMon(stagedAt: string): Promise<void> {
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (s && s.stagedAt === stagedAt) {
        await this.removeAt(i);
        return;
      }
    }
  }

  /**
   * @deprecated v2-cleanup candidate — new code should call `setPlacement`.
   */
  async setDestination(stagedAt: string, dest: StagedMonDestinationGen3 | null): Promise<void> {
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (s && s.stagedAt === stagedAt) {
        if (dest === null) {
          await this.setPlacement(i, null);
        } else {
          const fmt: 'frlg' | 'rse' =
            dest.destFormat === 'firered' || dest.destFormat === 'leafgreen' ? 'frlg' : 'rse';
          await this.setPlacement(i, {
            destBoxIndex: dest.destBoxIndex,
            destSlot: dest.destSlot,
            destCartLabel: dest.destCartLabel,
            destTid: dest.destTid,
            destFormat: fmt,
          });
        }
        return;
      }
    }
  }

  /**
   * @deprecated v2-cleanup candidate — synchronous legacy session view.
   */
  load(): StagingSessionV1 {
    return this.buildSessionV1();
  }

  // -------------------------------------------------------------------

  private buildSessionV1(): StagingSessionV1 {
    return {
      schemaVersion: 1,
      id: 'default',
      stagedMons: this.occupiedSlots().map(slotToLegacyMon),
      sessionMetadata: {
        createdAt: this.createdAt,
        lastModifiedAt: this.lastMutationISO,
      },
    };
  }

  private buildSessionV2(): StagingSessionV2 {
    return {
      schemaVersion: 2,
      id: 'default',
      slots: this.slots.slice(),
      sessionMetadata: {
        createdAt: this.createdAt,
        lastModifiedAt: this.lastMutationISO,
      },
    };
  }

  private fire(): void {
    const slotSnap = this.slots.slice();
    for (const listener of this.slotListeners) {
      try {
        listener(slotSnap);
      } catch {
        /* listener errors are isolated */
      }
    }
    if (this.legacyListeners.size > 0) {
      const session = this.buildSessionV1();
      for (const listener of this.legacyListeners) {
        try {
          listener(session);
        } catch {
          /* listener errors are isolated */
        }
      }
    }
  }

  private attachBroadcast(): void {
    const Ctor = broadcastChannelCtor();
    if (!Ctor) return;
    let channel: BroadcastChannelLike;
    try {
      channel = new Ctor(STAGING_BROADCAST_CHANNEL);
    } catch {
      return;
    }
    this.channel = channel;
    channel.onmessage = (ev: MessageEvent): void => {
      const msg = ev.data as { kind?: string } | undefined;
      if (!msg) return;
      if (msg.kind === 'staging-claim') {
        // Another tab just opened. Tell it we're already here.
        try {
          channel.postMessage({ kind: 'staging-already-open' });
        } catch {
          /* best-effort */
        }
        // Surface a banner in this tab too — the user is presumably
        // about to ping-pong between tabs.
        for (const l of this.multiTabListeners) {
          try {
            l({ kind: 'another-tab-claimed' });
          } catch {
            /* isolated */
          }
        }
      } else if (msg.kind === 'staging-already-open') {
        for (const l of this.multiTabListeners) {
          try {
            l({ kind: 'another-tab-claimed' });
          } catch {
            /* isolated */
          }
        }
      }
    };
    try {
      channel.postMessage({ kind: 'staging-claim' });
    } catch {
      /* best-effort */
    }
  }
}
