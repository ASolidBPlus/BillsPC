/**
 * S8v2.2.1 — integration test for the source → TRANSFER COPY pipeline.
 *
 * Invokes the production `runAddSelectedToTransfer` handler against a
 * spied FakeStagingStore. Asserts the handler:
 *   * calls `placeAt` exactly once per selected source mon, with
 *     monotonically advancing `idx` (0,1,2 for an empty store).
 *   * each payload's `pkBytes` carries the v2.2 sentinel byte 0xFE
 *     (i.e. `serializeGen12ForStaging` ran).
 *   * each payload's `speciesId` is the POST-CONVERSION ndex
 *     (AMEND-S8v2.2-8) — the fixture uses a fake `convert` that maps
 *     a Gen 2-only species (Lugia / 249) to a different Gen 1 ndex (1)
 *     so a regression that leaks `mon.speciesGen2Id` would visibly fail.
 *   * `state.sourceBytes` and `state.save` are NOT mutated.
 *   * the source selection clears after the batch (no `refsOverride`).
 *   * party-bucket mons in the selection are skipped + counted in the
 *     party-skip banner dispatch.
 */

import { describe, it, expect, vi } from 'vitest';
import { runAddSelectedToTransfer } from '../ui/v2Actions.js';
import type { ControllerDeps } from '../ui.js';
import type { Action, AppState, MonRef } from '../state.js';
import type { Gen12Pokemon, Gen3Intermediate } from '@pokeportal/core';
import { FakeStagingStore, makeGen2Mon, makeGen2SaveWithBox0 } from './_helpers/staging.js';

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

/**
 * Fake `convert` that maps Gen 2 species 249 → ndex 1 (post-conversion
 * remap), and leaves any other species alone. This is the
 * AMEND-S8v2.2-8 fixture — the speciesId stored in the slot must be
 * the POST-conversion ndex, not the source species.
 */
function fakeConvertWithRemap(mon: Gen12Pokemon): Gen3Intermediate {
  const post = mon.speciesGen2Id === 249 ? 1 : mon.speciesGen2Id;
  return neutralIntermediate(post);
}

function makeDeps(store: FakeStagingStore): ControllerDeps {
  return {
    parseSave: (() => null) as unknown as ControllerDeps['parseSave'],
    convert: fakeConvertWithRemap as unknown as ControllerDeps['convert'],
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

function loadedStateFor(
  save: ReturnType<typeof makeGen2SaveWithBox0>,
): AppState & { kind: 'loaded'; sourceBytes: Uint8Array } {
  return {
    kind: 'loaded',
    fileName: 'crystal.sav',
    save,
    sourceBytes: new Uint8Array(32768),
    results: new Map(),
    boxIndex: 0,
    cursor: { row: 0, col: 0 },
    openMon: null,
  };
}

describe('runAddSelectedToTransfer — source → TRANSFER COPY pipeline', () => {
  it('places each selected source mon into the next empty slot (0,1,2) with sentinel pkBytes', async () => {
    const mons = [
      makeGen2Mon({ speciesGen2Id: 158, nickname: 'TOTODILE' }), // box 0 slot 0
      makeGen2Mon({ speciesGen2Id: 155, nickname: 'CYNDAQUIL' }), // box 0 slot 1
      makeGen2Mon({ speciesGen2Id: 152, nickname: 'CHIKORITA' }), // box 0 slot 2
    ];
    const save = makeGen2SaveWithBox0(mons);
    const refs: MonRef[] = [
      { bucket: 'box', boxIndex: 0, slot: 0 },
      { bucket: 'box', boxIndex: 0, slot: 1 },
      { bucket: 'box', boxIndex: 0, slot: 2 },
    ];
    const baseState = loadedStateFor(save);
    const sourceBytes = baseState.sourceBytes;
    const sourceBytesSnapshot = sourceBytes.slice();
    const state: AppState = { ...baseState, v2SourceSelection: refs };
    const saveSnapshot = JSON.parse(
      JSON.stringify(save, (_k, v) => (v instanceof Uint8Array ? Array.from(v) : v)),
    );

    const store = new FakeStagingStore();
    const placeSpy = vi.spyOn(store, 'placeAt');
    const dispatched: Action[] = [];
    const dispatch = (a: Action): void => {
      dispatched.push(a);
    };

    await runAddSelectedToTransfer(state, dispatch, makeDeps(store));

    expect(placeSpy).toHaveBeenCalledTimes(3);
    const calls = placeSpy.mock.calls;
    expect(calls.map((c) => c[0])).toEqual([0, 1, 2]);

    // pkBytes sentinel byte 0xFE
    for (const [, payload] of calls) {
      expect(payload.pkBytes[0]).toBe(0xfe);
    }

    // state.sourceBytes + state.save not mutated
    expect(sourceBytes).toEqual(sourceBytesSnapshot);
    expect(
      JSON.parse(JSON.stringify(save, (_k, v) => (v instanceof Uint8Array ? Array.from(v) : v))),
    ).toEqual(saveSnapshot);

    // selection clear dispatched (no refsOverride)
    expect(dispatched).toEqual(
      expect.arrayContaining([{ type: 'v2_select_clear', side: 'source' }]),
    );
  });

  it('AMEND-S8v2.2-8 — slot.speciesId carries the POST-conversion ndex', async () => {
    // Source mon is Lugia (Gen 2 species 249); fakeConvert remaps it to
    // ndex 1. A regression that stores `mon.speciesGen2Id` (249) instead
    // of `conv.species` (1) would fail this assertion.
    const lugia = makeGen2Mon({ speciesGen2Id: 249, nickname: 'LUGIA' });
    const save = makeGen2SaveWithBox0([lugia]);
    const ref: MonRef = { bucket: 'box', boxIndex: 0, slot: 0 };
    const state: AppState = { ...loadedStateFor(save), v2SourceSelection: [ref] };
    const store = new FakeStagingStore();
    const placeSpy = vi.spyOn(store, 'placeAt');

    await runAddSelectedToTransfer(state, () => undefined, makeDeps(store));

    expect(placeSpy).toHaveBeenCalledTimes(1);
    const [, payload] = placeSpy.mock.calls[0]!;
    // Post-conversion ndex (1), NOT the source species (249).
    expect(payload.speciesId).toBe(1);
  });

  it('skips party-bucket refs and surfaces v2_transfer_party_skip', async () => {
    // Two box mons + one party mon in the selection. The party mon must
    // be skipped silently; the banner dispatch carries the count.
    const mons = [makeGen2Mon({ speciesGen2Id: 25 }), makeGen2Mon({ speciesGen2Id: 1 })];
    const save = makeGen2SaveWithBox0(mons);
    const refs: MonRef[] = [
      { bucket: 'box', boxIndex: 0, slot: 0 },
      { bucket: 'party', slot: 0 },
      { bucket: 'box', boxIndex: 0, slot: 1 },
    ];
    const state: AppState = { ...loadedStateFor(save), v2SourceSelection: refs };
    const store = new FakeStagingStore();
    const placeSpy = vi.spyOn(store, 'placeAt');
    const dispatched: Action[] = [];

    await runAddSelectedToTransfer(state, (a) => dispatched.push(a), makeDeps(store));

    // Only the two box refs got placed; party ref was filtered.
    expect(placeSpy).toHaveBeenCalledTimes(2);
    const partySkip = dispatched.find((a) => a.type === 'v2_transfer_party_skip');
    expect(partySkip).toBeDefined();
    expect((partySkip as { type: 'v2_transfer_party_skip'; skipped: number }).skipped).toBe(1);
  });
});
