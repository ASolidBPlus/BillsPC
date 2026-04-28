/**
 * S8v2.3 — `runCommitDestination` SAV-mode happy path + the
 * AMEND-S8v2.3-3 decode → convert → pack pipeline.
 *
 * Asserts:
 *   * For each placed slot, `controller.convert` is called once with
 *     the decoded `Gen12Pokemon` (proves the v2.2 sentinel-JSON snapshot
 *     decodes correctly — NOT the legacy `pkBytes.length === 80` filter).
 *   * `controller.packBoxed` is called once per placed slot.
 *   * Triggers `downloadFn` with the dest filename + composed bytes.
 *   * Removes each committed slot via `removeAt`.
 *   * Dispatches `v2_dest_committed` + `v2_dest_bytes_refreshed`.
 *   * Convert-refusal MID-BATCH (slot 1) → handler bails BEFORE any
 *     mutation; downloadFn never fires; v2_dest_committed never
 *     dispatched; setPlacement / removeAt never invoked.
 *   * Entry guard: `!state.dest` returns without side effects.
 */

import { describe, it, expect, vi } from 'vitest';
import { runCommitDestination } from '../ui/v2Actions.js';
import type { ControllerDeps } from '../ui.js';
import type { Action, AppState } from '../state.js';
import type {
  Gen12Pokemon,
  Gen3Intermediate,
  Gen3SaveContents,
  StagedMonRefGen3,
} from '@pokeportal/core';
import {
  FakeStagingStore,
  makeGen2SaveWithBox0,
  makeGen3Save,
  makeSlot,
} from './_helpers/staging.js';
import type { StagedSlot } from '../cart/stagingStore.types.js';
import { serializeGen12ForStaging } from '../cart/stagingPayload.js';

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

function makeMon(species: number): Gen12Pokemon {
  return {
    sourceGen: 2,
    speciesGen2Id: species,
    level: 50,
    exp: 125_000,
    dvs: { atk: 15, def: 15, spe: 15, special: 15 },
    statExp: { hp: 0, atk: 0, def: 0, spe: 0, special: 0 },
    moves: [33, 0, 0, 0],
    pp: [35, 0, 0, 0],
    ppUps: [0, 0, 0, 0],
    heldItemGen2Id: null,
    friendship: 70,
    pokerusByte: 0,
    otNameBytes: new Uint8Array(11).fill(0x50),
    tid: 12345,
    nicknameBytes: new Uint8Array(11).fill(0x50),
    language: 2,
  };
}

interface DepsOpts {
  /** When set, `convert` returns refusal for this species (mid-batch
   *  refusal test). */
  refuseSpecies?: number;
  /** Capture all convert/pack invocations for assertion. */
  convertSpy?: ReturnType<typeof vi.fn>;
  packSpy?: ReturnType<typeof vi.fn>;
  parseSpy?: ReturnType<typeof vi.fn>;
}

function makeDeps(store: FakeStagingStore, opts: DepsOpts = {}): ControllerDeps {
  return {
    parseSave: (() => null) as unknown as ControllerDeps['parseSave'],
    convert: ((mon: Gen12Pokemon) => {
      opts.convertSpy?.(mon);
      if (opts.refuseSpecies !== undefined && mon.speciesGen2Id === opts.refuseSpecies) {
        return { __refusal: true, reason: 'TEST', message: 'forced refusal' };
      }
      return neutralIntermediate(mon.speciesGen2Id);
    }) as unknown as ControllerDeps['convert'],
    packBoxed: ((intermediate: Gen3Intermediate) => {
      opts.packSpy?.(intermediate);
      // Return a stable 80-byte buffer keyed by species so the test can
      // distinguish per-mon outputs.
      const out = new Uint8Array(80);
      out[0] = intermediate.species & 0xff;
      return out;
    }) as unknown as ControllerDeps['packBoxed'],
    isSaveError: (() => false) as unknown as ControllerDeps['isSaveError'],
    isRefusal: ((x: unknown) =>
      typeof x === 'object' &&
      x !== null &&
      (x as { __refusal?: boolean }).__refusal === true) as unknown as ControllerDeps['isRefusal'],
    parseGen3Save: ((bytes: Uint8Array) => {
      opts.parseSpy?.(bytes);
      return makeGen3Save();
    }) as unknown as ControllerDeps['parseGen3Save'],
    isGen3SaveError: (() => false) as unknown as ControllerDeps['isGen3SaveError'],
    injectIntoSave: (() => null) as unknown as ControllerDeps['injectIntoSave'],
    isGen3InjectError: (() => false) as unknown as ControllerDeps['isGen3InjectError'],
    deleteMonGen1: (() => null) as unknown as ControllerDeps['deleteMonGen1'],
    deleteMonGen2: (() => null) as unknown as ControllerDeps['deleteMonGen2'],
    getStagingStore: () => store.asStore(),
  };
}

function placedSlot(idx: number, species: number, destSlot: number): StagedSlot {
  const base = makeSlot(idx, {
    speciesId: species,
    placement: {
      destBoxIndex: 0,
      destSlot,
      destCartLabel: 'POKEMON EMERALD',
      destTid: 99999,
      destFormat: 'rse',
    },
  });
  // Replace pkBytes with a v2.2 sentinel-JSON snapshot of a Gen12Pokemon
  // so the dest-commit handler's decode path actually has something
  // valid to round-trip.
  return { ...base, pkBytes: serializeGen12ForStaging(makeMon(species)) };
}

function destState(store: FakeStagingStore, dest: Gen3SaveContents): AppState {
  return {
    kind: 'loaded',
    fileName: 'crystal.sav',
    save: makeGen2SaveWithBox0([]),
    sourceBytes: new Uint8Array(32768),
    results: new Map(),
    boxIndex: 0,
    cursor: { row: 0, col: 0 },
    openMon: null,
    dest: {
      fileName: 'emerald.sav',
      save: dest,
      boxIndex: 0,
      cursor: { row: 0, col: 0 },
    },
    staging: {
      slots: store.getAllSlots(),
      stagedMons: [],
      rightPaneSubview: 'staging',
      sessionMetadata: { createdAt: 'iso', lastModifiedAt: 'iso' },
    },
  };
}

describe('runCommitDestination — SAV mode + AMEND-S8v2.3-3 pipeline', () => {
  it('decodes pkBytes → convert → pack → composeDestinationWrite for each placed slot', async () => {
    const store = new FakeStagingStore();
    // 3 placed slots targeting destSlots 0, 1, 2.
    const slots: Array<StagedSlot | null> = Array.from({ length: 30 }, () => null);
    slots[0] = placedSlot(0, 158, 0);
    slots[1] = placedSlot(1, 155, 1);
    slots[2] = placedSlot(2, 152, 2);
    // 4th slot is occupied but UNPLACED — must be skipped.
    slots[3] = makeSlot(3);
    store.seed(slots);
    const dest = makeGen3Save();
    const state = destState(store, dest);

    const convertSpy = vi.fn();
    const packSpy = vi.fn();
    const parseSpy = vi.fn();
    const removeSpy = vi.spyOn(store, 'removeAt');
    const downloadCalls: Array<[string, Uint8Array]> = [];
    const dispatched: Action[] = [];

    await runCommitDestination({
      state,
      dispatch: (a) => dispatched.push(a),
      controller: makeDeps(store, { convertSpy, packSpy, parseSpy }),
      flashDeps: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      confirmFlashDialog: (() => document.createElement('div')) as any,
      downloadFn: (n, b) => downloadCalls.push([n, b]),
      // Stub composeDestinationWrite — the real one calls injectIntoSave
      // which requires properly-encrypted 80-byte Gen 3 slot records.
      // The test's fake `packBoxed` returns species-tagged dummies, so
      // we sidestep the inject pipeline and assert the handler's
      // contract directly.
      composeDest: ((_save: unknown, refs: ReadonlyArray<StagedMonRefGen3>) => {
        // Sanity-check the shape: each ref carries an 80-byte payload.
        for (const r of refs) {
          if (r.bytes.length !== 80) {
            return {
              kind: 'compose_error',
              reason: 'GEN3_INJECT_FAILED',
              underlying: { kind: 'gen3_inject_error', reason: 'BAD_PAYLOAD_SIZE', message: 'len' },
              stagedIndex: 0,
            };
          }
        }
        return new Uint8Array(131072).fill(0xee);
      }) as never,
    });

    // convert / packBoxed each fired ONCE per placed slot — 3 times.
    expect(convertSpy).toHaveBeenCalledTimes(3);
    expect(packSpy).toHaveBeenCalledTimes(3);
    // Each convert was called with a roundtripped Gen12Pokemon (NOT raw
    // bytes), and species matched the seed.
    expect(convertSpy.mock.calls.map((c) => c[0].speciesGen2Id)).toEqual([158, 155, 152]);
    // Download triggered once with the dest filename.
    expect(downloadCalls).toHaveLength(1);
    expect(downloadCalls[0]![0]).toBe('emerald.sav');
    // removeAt fired per committed slot.
    expect(removeSpy.mock.calls.map((c) => c[0])).toEqual([0, 1, 2]);
    // v2_dest_committed dispatched with the right slotIdxs.
    const committed = dispatched.find((a) => a.type === 'v2_dest_committed');
    expect((committed as { slotIdxs: ReadonlyArray<number> }).slotIdxs).toEqual([0, 1, 2]);
    // bytes refresh dispatched + parseGen3Save called against composed bytes.
    expect(parseSpy).toHaveBeenCalledTimes(1);
    expect(dispatched.find((a) => a.type === 'v2_dest_bytes_refreshed')).toBeDefined();
  });

  // AMEND-S8v2.3-3 — convert refuses mid-batch → bail with no mutation.
  it('convert-refusal mid-batch → handler bails; no removeAt; no v2_dest_committed', async () => {
    const store = new FakeStagingStore();
    const slots: Array<StagedSlot | null> = Array.from({ length: 30 }, () => null);
    slots[0] = placedSlot(0, 158, 0);
    slots[1] = placedSlot(1, 999, 1); // species 999 → refused
    slots[2] = placedSlot(2, 152, 2);
    store.seed(slots);
    const state = destState(store, makeGen3Save());

    const removeSpy = vi.spyOn(store, 'removeAt');
    const downloadCalls: Array<[string, Uint8Array]> = [];
    const dispatched: Action[] = [];

    await runCommitDestination({
      state,
      dispatch: (a) => dispatched.push(a),
      controller: makeDeps(store, { refuseSpecies: 999 }),
      flashDeps: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      confirmFlashDialog: (() => document.createElement('div')) as any,
      downloadFn: (n, b) => downloadCalls.push([n, b]),
    });

    expect(downloadCalls).toHaveLength(0);
    expect(removeSpy).not.toHaveBeenCalled();
    expect(dispatched.find((a) => a.type === 'v2_dest_committed')).toBeUndefined();
    expect(dispatched.find((a) => a.type === 'v2_dest_bytes_refreshed')).toBeUndefined();
  });

  it('entry guard: state.dest === undefined → no-op', async () => {
    const store = new FakeStagingStore();
    store.seed([placedSlot(0, 158, 0), ...Array.from({ length: 29 }, () => null)]);
    const state: AppState = { kind: 'idle' };
    const removeSpy = vi.spyOn(store, 'removeAt');
    const downloadCalls: Array<[string, Uint8Array]> = [];
    const dispatched: Action[] = [];

    await runCommitDestination({
      state,
      dispatch: (a) => dispatched.push(a),
      controller: makeDeps(store),
      flashDeps: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      confirmFlashDialog: (() => document.createElement('div')) as any,
      downloadFn: (n, b) => downloadCalls.push([n, b]),
    });

    expect(removeSpy).not.toHaveBeenCalled();
    expect(downloadCalls).toHaveLength(0);
    expect(dispatched).toHaveLength(0);
  });

  it('no-op when no placed slots (early return)', async () => {
    const store = new FakeStagingStore();
    // Slots present but none have placement.
    store.seed([makeSlot(0), makeSlot(1), ...Array.from({ length: 28 }, () => null)]);
    const state = destState(store, makeGen3Save());
    const removeSpy = vi.spyOn(store, 'removeAt');
    const downloadCalls: Array<[string, Uint8Array]> = [];

    await runCommitDestination({
      state,
      dispatch: () => undefined,
      controller: makeDeps(store),
      flashDeps: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      confirmFlashDialog: (() => document.createElement('div')) as any,
      downloadFn: (n, b) => downloadCalls.push([n, b]),
    });

    expect(removeSpy).not.toHaveBeenCalled();
    expect(downloadCalls).toHaveLength(0);
  });
});
