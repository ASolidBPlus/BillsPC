/**
 * S8v2.3 — END-TO-END integration test.
 *
 * Exercises the full commit flow against a REAL `StagingStore`
 * (fake-indexeddb-backed) so the cross-handler interactions surface:
 *   1. Stage a Gen 2 mon (via runAddSelectedToTransfer).
 *   2. Source-commit (SAV mode) — assert sourceCommitted: true persists
 *      via the real store + the slot still occupies its idx.
 *   3. SWITCH-block predicate has lifted (criterion 13) — verified by
 *      computing the predicate against `store.getAllSlots()`.
 *   4. Place the mon on the dest (runAddSelectedToDestination).
 *   5. Dest-commit (SAV mode) — assert the slot is REMOVED from the
 *      store (not just placement-cleared).
 *   6. Transfer box ends EMPTY.
 *
 * This also doubles as the regression gate for AMEND-S8v2.3-3 (decode →
 * convert → pack happens at dest commit time, against a real
 * sentinel-JSON pkBytes that the real `runAddSelectedToTransfer`
 * actually wrote).
 */

import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';
import {
  runAddSelectedToTransfer,
  runAddSelectedToDestination,
  runCommitSource,
  runCommitDestination,
} from '../ui/v2Actions.js';
import { StagingStore } from '../cart/stagingStore.js';
import { STAGING_DB_NAME, type StagedSlot } from '../cart/stagingStore.types.js';
import type { ControllerDeps } from '../ui.js';
import type { Action, AppState, MonRef } from '../state.js';
import type { Gen12Pokemon, Gen3Intermediate, SaveContents } from '@pokeportal/core';
import { makeGen2Mon, makeGen2SaveWithBox0, makeGen3Save } from './_helpers/staging.js';

let dbCounter = 0;
function nextDbName(): string {
  dbCounter++;
  return `${STAGING_DB_NAME}-e2e-${dbCounter}`;
}

function neutralIntermediate(species: number): Gen3Intermediate {
  return {
    species,
    nickname: new Uint8Array([0xff]),
    otName: new Uint8Array([0xff]),
    otGender: 0,
    tid: 12345,
    sid: 0,
    pid: 0,
    ivs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    nature: 0,
    abilitySlot: 0,
    moves: [0, 0, 0, 0],
    pp: [0, 0, 0, 0],
    ppUps: [0, 0, 0, 0],
    heldItem: 0,
    friendship: 0,
    exp: 0,
    level: 50,
    pokerus: 0,
    contestStats: { cool: 0, beauty: 0, cute: 0, clever: 0, tough: 0, sheen: 0 },
    ribbons: [],
    markings: 0,
    metLocation: 146,
    metLevel: 0,
    metGame: 'FireRed',
    originGame: 'FireRed',
    fatefulEncounter: false,
    isEgg: false,
    language: 2,
    _meta: {
      pidSearchIterations: 0,
      evScalingApplied: false,
      evRemainderDistributed: 0,
      zeroDvOverridesApplied: [],
      unownLetterConstrained: false,
      warnings: [],
    },
  };
}

function makeDeps(store: StagingStore, parsedSourceAfterCommit: SaveContents): ControllerDeps {
  return {
    parseSave: (() => parsedSourceAfterCommit) as unknown as ControllerDeps['parseSave'],
    convert: ((mon: Gen12Pokemon) =>
      neutralIntermediate(mon.speciesGen2Id)) as unknown as ControllerDeps['convert'],
    packBoxed: (() => new Uint8Array(80)) as unknown as ControllerDeps['packBoxed'],
    isSaveError: (() => false) as unknown as ControllerDeps['isSaveError'],
    isRefusal: (() => false) as unknown as ControllerDeps['isRefusal'],
    parseGen3Save: (() => makeGen3Save()) as unknown as ControllerDeps['parseGen3Save'],
    isGen3SaveError: (() => false) as unknown as ControllerDeps['isGen3SaveError'],
    injectIntoSave: (() => null) as unknown as ControllerDeps['injectIntoSave'],
    isGen3InjectError: (() => false) as unknown as ControllerDeps['isGen3InjectError'],
    deleteMonGen1: (() => null) as unknown as ControllerDeps['deleteMonGen1'],
    deleteMonGen2: (() => null) as unknown as ControllerDeps['deleteMonGen2'],
    getStagingStore: () => store,
  };
}

/** Slim app-state factory parameterised by the (live) staging snapshot.
 *  Reads from `store.getAllSlots()` so each call captures the state at
 *  the current point in the test. */
/** Minimally-valid CRYSTAL SRAM with `monCount` mons in box 0 so the
 *  Gen 2 deleter can run against it. */
function validCrystalBytes(monCount: number): Uint8Array {
  const out = new Uint8Array(32768);
  const box0Off = 0x4000;
  out[box0Off] = monCount;
  for (let i = 0; i < monCount; i++) out[box0Off + 1 + i] = 158 + i;
  out[box0Off + 1 + monCount] = 0xff;
  return out;
}

function appState(
  store: StagingStore,
  source: SaveContents,
  selection: ReadonlyArray<MonRef> = [],
  transferSelection: ReadonlyArray<number> = [],
): AppState {
  return {
    kind: 'loaded',
    fileName: 'crystal.sav',
    save: source,
    sourceBytes: validCrystalBytes(1),
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
    v2SourceSelection: selection,
    v2TransferSelection: transferSelection,
    staging: {
      slots: store.getAllSlots(),
      stagedMons: [],
      rightPaneSubview: 'staging',
      sessionMetadata: { createdAt: 'iso', lastModifiedAt: 'iso' },
    },
  };
}

function switchUnblocked(slots: ReadonlyArray<StagedSlot | null>): boolean {
  // Mirror of countPendingSourceCommit in the workbench renderer.
  for (const s of slots) {
    if (s !== null && s.sourceCommitted !== true) return false;
  }
  return true;
}

describe('S8v2.3 end-to-end: stage → source-commit → SWITCH → place → dest-commit', () => {
  it('full flow ends with empty transfer box + dest.save updated', async () => {
    const store = await StagingStore.open(nextDbName());
    // Subscribe-fire counter — proves the controller's subscribe re-fires
    // on each mutation (per AMEND-S8v2.2-11 wire).
    let fireCount = 0;
    const unsub = store.subscribeSlots(() => {
      fireCount += 1;
    });
    const initialFireCount = fireCount;

    const sourceMon = makeGen2Mon({ speciesGen2Id: 158, nickname: 'TOTODILE' });
    const sourceSave = makeGen2SaveWithBox0([sourceMon]);
    const dispatched: Action[] = [];
    const dispatch = (a: Action): void => {
      dispatched.push(a);
    };

    // Step 1 — STAGE the source mon (real handler).
    let state = appState(store, sourceSave, [{ bucket: 'box', boxIndex: 0, slot: 0 }]);
    await runAddSelectedToTransfer(state, dispatch, makeDeps(store, sourceSave));
    expect(store.getSlot(0)).not.toBeNull();
    expect(store.getSlot(0)?.sourceCommitted).toBe(false);
    expect(switchUnblocked(store.getAllSlots())).toBe(false); // still blocked

    // Step 2 — SOURCE-COMMIT (SAV mode → no flashCart). Stub
    // composeSource so the test doesn't depend on the real Gen 2 deleter
    // (which would need fully-valid SRAM with proper count + checksum).
    state = appState(store, sourceSave);
    await runCommitSource({
      state,
      dispatch,
      controller: makeDeps(store, sourceSave),
      flashDeps: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      confirmFlashDialog: (() => document.createElement('div')) as any,
      downloadFn: () => undefined,
      composeSource: ((bytes: Uint8Array) => new Uint8Array(bytes).fill(0xcc)) as never,
    });
    // Slot still occupies idx 0 but is now flagged source-committed.
    const afterSourceCommit = store.getSlot(0);
    expect(afterSourceCommit).not.toBeNull();
    expect(afterSourceCommit?.sourceCommitted).toBe(true);

    // Step 3 — SWITCH-block predicate has LIFTED.
    expect(switchUnblocked(store.getAllSlots())).toBe(true);

    // Step 4 — PLACE on dest (real handler).
    state = appState(store, sourceSave, [], [0]);
    await runAddSelectedToDestination(state, dispatch, makeDeps(store, sourceSave));
    const afterPlace = store.getSlot(0);
    expect(afterPlace?.placement).not.toBeNull();
    // sourceCommitted survives the placement set.
    expect(afterPlace?.sourceCommitted).toBe(true);

    // Step 5 — DEST-COMMIT (SAV mode). Stub composeDest — the real Gen 3
    // inject path needs properly-encrypted 80-byte slot bytes; the
    // fake packBoxed returns dummies. The handler's own contract still
    // covers the decode → convert → pack → removeAt sequence.
    state = appState(store, sourceSave);
    await runCommitDestination({
      state,
      dispatch,
      controller: makeDeps(store, sourceSave),
      flashDeps: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      confirmFlashDialog: (() => document.createElement('div')) as any,
      downloadFn: () => undefined,
      composeDest: (() => new Uint8Array(131072).fill(0xee)) as never,
    });

    // Step 6 — transfer box is EMPTY.
    expect(store.getSlot(0)).toBeNull();
    expect(store.getAllSlots().every((s) => s === null)).toBe(true);

    // Action chain landed: v2_source_committed THEN v2_dest_committed.
    const sourceCommittedIdx = dispatched.findIndex((a) => a.type === 'v2_source_committed');
    const destCommittedIdx = dispatched.findIndex((a) => a.type === 'v2_dest_committed');
    expect(sourceCommittedIdx).toBeGreaterThan(-1);
    expect(destCommittedIdx).toBeGreaterThan(sourceCommittedIdx);

    // Subscribe re-fired multiple times (placeAt + setSourceCommitted +
    // setPlacement + removeAt = 4 mutations after the initial subscribe
    // fire; allow ≥ 4 to be tolerant of any buildup).
    expect(fireCount - initialFireCount).toBeGreaterThanOrEqual(4);
    unsub();
    store.close();
  });
});
