/**
 * S8v2.2.1 — integration test for the 30-slot capacity cap + banner.
 *
 * `runAddSelectedToTransfer` caps the batch at the transfer box's
 * remaining capacity (30 - occupiedCount). Excess refs are silently
 * skipped + the count surfaces via `v2_transfer_box_full`.
 *
 * Scenario A: 28 staged + 5 selected → 2 placed, banner.skipped = 3.
 * Scenario B: 30 staged + 5 selected → 0 placed, banner.skipped = 5.
 *
 * Both scenarios use the production handler with a spied
 * FakeStagingStore.
 */

import { describe, it, expect, vi } from 'vitest';
import { runAddSelectedToTransfer } from '../ui/v2Actions.js';
import type { ControllerDeps } from '../ui.js';
import type { Action, AppState, MonRef } from '../state.js';
import type { Gen3Intermediate } from '@pokeportal/core';
import {
  FakeStagingStore,
  makeGen2Mon,
  makeGen2SaveWithBox0,
  makeSlot,
} from './_helpers/staging.js';
import { reducer } from '../state.js';

function fakeIntermediate(species: number): Gen3Intermediate {
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

function makeDeps(store: FakeStagingStore): ControllerDeps {
  return {
    parseSave: (() => null) as unknown as ControllerDeps['parseSave'],
    convert: ((mon: { speciesGen2Id: number }) =>
      fakeIntermediate(mon.speciesGen2Id)) as unknown as ControllerDeps['convert'],
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

function buildState(opts: { selectedCount: number; preStagedCount: number }): {
  state: AppState;
  refs: MonRef[];
  store: FakeStagingStore;
} {
  // Source has 30 mons in box 0 so we can address slots up to 29.
  const mons = Array.from({ length: 30 }, (_, i) =>
    makeGen2Mon({ speciesGen2Id: 25, nickname: `M${i}` }),
  );
  const save = makeGen2SaveWithBox0(mons);
  // Selection — pick the FIRST `selectedCount` mons that are NOT
  // already staged (the prior batch used slots 0..preStagedCount-1
  // pointing at source slots 0..preStagedCount-1, so the new selection
  // starts at slot preStagedCount).
  const refs: MonRef[] = Array.from({ length: opts.selectedCount }, (_, i) => ({
    bucket: 'box' as const,
    boxIndex: 0,
    slot: opts.preStagedCount + i,
  }));
  const store = new FakeStagingStore();
  // Pre-stage `preStagedCount` slots so the cap math is realistic.
  // Use placeholder source slots that DON'T overlap with the new
  // selection (slots 0..preStagedCount-1, vs selection starting at
  // preStagedCount).
  const preSlots = Array.from({ length: 30 }, (_, i) =>
    i < opts.preStagedCount ? makeSlot(i, { sourceSlot: i }) : null,
  );
  store.seed(preSlots);

  const state: AppState = {
    kind: 'loaded',
    fileName: 'crystal.sav',
    save,
    sourceBytes: new Uint8Array(32768),
    results: new Map(),
    boxIndex: 0,
    cursor: { row: 0, col: 0 },
    openMon: null,
    v2SourceSelection: refs,
    staging: {
      slots: preSlots,
      stagedMons: [],
      rightPaneSubview: 'staging',
      sessionMetadata: { createdAt: 'iso', lastModifiedAt: 'iso' },
    },
  };
  return { state, refs, store };
}

describe('runAddSelectedToTransfer — 30-slot capacity cap', () => {
  it('28 staged + 5 selected → 2 placeAt calls; banner.skipped === 3', async () => {
    const { state, store } = buildState({ selectedCount: 5, preStagedCount: 28 });
    const placeSpy = vi.spyOn(store, 'placeAt');
    const dispatched: Action[] = [];

    await runAddSelectedToTransfer(state, (a) => dispatched.push(a), makeDeps(store));

    expect(placeSpy).toHaveBeenCalledTimes(2);
    const fullBanner = dispatched.find((a) => a.type === 'v2_transfer_box_full');
    expect(fullBanner).toBeDefined();
    expect((fullBanner as { type: 'v2_transfer_box_full'; skipped: number }).skipped).toBe(3);

    // Run the dispatched action through the reducer to confirm the
    // banner state shape matches the criterion.
    const next = reducer({ kind: 'idle' }, fullBanner!);
    expect(next.transferBoxFullBanner).toEqual({ skipped: 3 });
  });

  it('30 staged + 5 selected → 0 placeAt calls; banner.skipped === 5', async () => {
    const { state, store } = buildState({ selectedCount: 5, preStagedCount: 30 });
    const placeSpy = vi.spyOn(store, 'placeAt');
    const dispatched: Action[] = [];

    await runAddSelectedToTransfer(state, (a) => dispatched.push(a), makeDeps(store));

    expect(placeSpy).toHaveBeenCalledTimes(0);
    const fullBanner = dispatched.find((a) => a.type === 'v2_transfer_box_full');
    expect(fullBanner).toBeDefined();
    expect((fullBanner as { type: 'v2_transfer_box_full'; skipped: number }).skipped).toBe(5);
  });
});
