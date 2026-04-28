/**
 * S8v2.2 — verify the controller's subscribe wire (per AMEND-S8v2.2-11).
 *
 * The controller's `factory().then(store => store.subscribe(...))` wire
 * must dispatch `staging_loaded` with both the legacy session AND the
 * new slot-addressed `slots` snapshot per DECISION-S8v2.2-7. The
 * reducer's `staging_loaded` case populates `state.staging.slots` from
 * `action.slots` (or derives from session when slots is absent).
 *
 * Stub-out the StagingStore so we can capture the subscribe callback
 * the controller registers and trigger it directly.
 */

import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';
import {
  createController,
  DEFAULT_DEPS,
  type ControllerDeps,
} from '../ui.js';
import type {
  StagingListener,
  StagingMultiTabListener,
  StagingSnapshotListener,
  StagingStore,
} from '../cart/stagingStore.js';
import type {
  StagedSlot,
  StagingSessionV1,
} from '../cart/stagingStore.types.js';

class FakeStagingStore {
  legacyListener: StagingListener | null = null;
  multiTabListener: StagingMultiTabListener | null = null;
  pendingMigrationOverflow = 0;
  private slots: ReadonlyArray<StagedSlot | null> = Array.from({ length: 30 }, () => null);

  subscribe(listener: StagingListener): () => void {
    this.legacyListener = listener;
    listener({
      schemaVersion: 1,
      id: 'default',
      stagedMons: [],
      sessionMetadata: { createdAt: 'iso', lastModifiedAt: 'iso' },
    });
    return () => {
      this.legacyListener = null;
    };
  }
  subscribeSlots(listener: StagingSnapshotListener): () => void {
    void listener;
    return () => undefined;
  }
  subscribeMultiTab(listener: StagingMultiTabListener): () => void {
    this.multiTabListener = listener;
    return () => {
      this.multiTabListener = null;
    };
  }
  getAllSlots(): ReadonlyArray<StagedSlot | null> {
    return this.slots;
  }
  setSlots(slots: ReadonlyArray<StagedSlot | null>): void {
    this.slots = slots;
  }
  fireSession(session: StagingSessionV1): void {
    this.legacyListener?.(session);
  }
  fireMultiTab(): void {
    this.multiTabListener?.({ kind: 'another-tab-claimed' });
  }
  close(): void {
    /* no-op */
  }
}

describe('controller staging subscribe wire (AMEND-S8v2.2-11)', () => {
  it('dispatches staging_loaded with `slots` from store.getAllSlots() on subscribe', async () => {
    const fake = new FakeStagingStore();
    // Pre-populate the fake store's slots before the controller's
    // subscribe registers — the immediate firing on subscribe should
    // carry the slots snapshot.
    const slot: StagedSlot = {
      idx: 0,
      pkBytes: new Uint8Array([0xfe, 1]),
      speciesId: 158,
      nicknameDisplay: 'TOTODILE',
      sourceCartLabel: 'POKEMON CRYSTAL',
      sourceTid: 1,
      sourceFamily: 'gen2',
      sourceOtName: 'OT',
      sourceRef: { bucket: 'box', boxIndex: 0, slot: 0 },
      sourceRefKey: 'POKEMON CRYSTAL|1|box:0:0',
      stagedAt: 'iso',
      placement: null,
    };
    const slots = [slot, ...Array.from({ length: 29 }, () => null)] as ReadonlyArray<
      StagedSlot | null
    >;
    fake.setSlots(slots);

    const root = document.createElement('div');
    document.body.append(root);
    const deps: ControllerDeps = {
      ...DEFAULT_DEPS,
      stagingStoreFactory: async () => fake as unknown as StagingStore,
    };
    const controller = createController(root, deps);

    // Wait for the async subscribe wire to fire.
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    expect(controller.state().staging?.slots[0]?.speciesId).toBe(158);
    // The stagedMons legacy alias is also populated (per AMEND-S8v2.2-12).
    expect(controller.state().staging?.stagedMons.length).toBe(1);
  });

  it('dispatches multi_tab_claim_received when subscribeMultiTab fires', async () => {
    const fake = new FakeStagingStore();
    const root = document.createElement('div');
    document.body.append(root);
    const deps: ControllerDeps = {
      ...DEFAULT_DEPS,
      stagingStoreFactory: async () => fake as unknown as StagingStore,
    };
    const controller = createController(root, deps);
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(controller.state().multiTabBanner).toBeUndefined();
    fake.fireMultiTab();
    expect(controller.state().multiTabBanner).toBe(true);
  });

  it('dispatches staging_migration_overflow once when pending', async () => {
    const fake = new FakeStagingStore();
    fake.pendingMigrationOverflow = 5;
    const root = document.createElement('div');
    document.body.append(root);
    const deps: ControllerDeps = {
      ...DEFAULT_DEPS,
      stagingStoreFactory: async () => fake as unknown as StagingStore,
    };
    const controller = createController(root, deps);
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(controller.state().stagingMigrationOverflowBanner).toEqual({ dropped: 5 });
    // After the dispatch, the store flag is cleared so a re-render
    // doesn't re-dispatch.
    expect(fake.pendingMigrationOverflow).toBe(0);
  });
});
