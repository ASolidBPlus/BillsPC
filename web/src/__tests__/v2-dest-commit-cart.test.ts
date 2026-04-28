/**
 * S8v2.3 — `runCommitDestination` cart-mode path.
 *
 * Asserts:
 *   * Typed-PROCEED gate fires (action='WITH COMMIT').
 *   * `flashCart` invoked with composed bytes + dest cart's bytes.
 *   * On success → removeAt + v2_dest_committed + v2_dest_bytes_refreshed.
 *   * On failure (AMEND-S8v2.3-8) → removeAt is NEVER called;
 *     v2_dest_committed NEVER dispatched; flash_failed IS dispatched.
 *   * In-flight guard (AMEND-S8v2.3-6) → no-op when cart_flash_progressing.
 */

import { describe, it, expect, vi } from 'vitest';
import { runCommitDestination } from '../ui/v2Actions.js';
import type { ControllerDeps } from '../ui.js';
import type { Action, AppState } from '../state.js';
import type { CartFlasherDeps, CartFlashResult } from '../cart/cartFlasher.js';
import { CartError } from '@pokeportal/core';
import type { Gen12Pokemon, Gen3Intermediate } from '@pokeportal/core';
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

function makeDeps(store: FakeStagingStore): ControllerDeps {
  return {
    parseSave: (() => null) as unknown as ControllerDeps['parseSave'],
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
    getStagingStore: () => store.asStore(),
  };
}

function placedSlot(idx: number, destSlot: number): StagedSlot {
  const base = makeSlot(idx, {
    speciesId: 158,
    placement: {
      destBoxIndex: 0,
      destSlot,
      destCartLabel: 'POKEMON EMERALD',
      destTid: 99999,
      destFormat: 'rse',
    },
  });
  return { ...base, pkBytes: serializeGen12ForStaging(makeMon(158)) };
}

function destCartState(store: FakeStagingStore): AppState {
  return {
    kind: 'loaded',
    fileName: 'crystal.sav',
    save: makeGen2SaveWithBox0([]),
    sourceBytes: new Uint8Array(32768),
    results: new Map(),
    boxIndex: 0,
    cursor: { row: 0, col: 0 },
    openMon: null,
    cartConnection: { variant: 'lesserkuma', deviceId: 'POKEMON EMERALD (128 KB)' },
    dest: {
      fileName: 'emerald.sav',
      save: makeGen3Save(),
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function autoConfirmDialog(): { spy: ReturnType<typeof vi.fn>; fn: any } {
  const spy = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fn = (props: any): HTMLElement => {
    spy(props);
    queueMicrotask(() => props.onConfirm());
    return document.createElement('div');
  };
  return { spy, fn };
}

describe('runCommitDestination — cart mode (S8v2.3)', () => {
  it('typed-PROCEED + flashCart invoked + slots removed on ok', async () => {
    const store = new FakeStagingStore();
    store.seed([placedSlot(0, 0), placedSlot(1, 1), ...Array.from({ length: 28 }, () => null)]);
    const state = destCartState(store);
    const dispatched: Action[] = [];
    const removeSpy = vi.spyOn(store, 'removeAt');
    const { spy: dialogSpy, fn: confirmFn } = autoConfirmDialog();

    const flashCalls: Array<{ deps: unknown; opts: Record<string, unknown> }> = [];
    const flashSpy = vi.fn(
      async (
        flashDepsArg: unknown,
        flashOpts: Record<string, unknown>,
      ): Promise<CartFlashResult> => {
        flashCalls.push({ deps: flashDepsArg, opts: flashOpts });
        return { kind: 'ok', verifiedBytes: new Uint8Array(131072) };
      },
    );

    await runCommitDestination({
      state,
      dispatch: (a) => dispatched.push(a),
      controller: makeDeps(store),
      flashDeps: { requestPort: async () => ({}) as never } as CartFlasherDeps,
      confirmFlashDialog: confirmFn,
      downloadFn: () => undefined,
      flash: flashSpy as never,
      // Stub composeDest so the test sidesteps the real Gen 3 inject
      // pipeline (the fake packBoxed returns dummy 80-byte buffers).
      composeDest: (() => new Uint8Array(131072).fill(0xee)) as never,
    });

    expect(dialogSpy).toHaveBeenCalledTimes(1);
    expect(dialogSpy.mock.calls[0]![0].action).toBe('WITH COMMIT');
    expect(flashSpy).toHaveBeenCalledTimes(1);
    expect(flashCalls).toHaveLength(1);
    expect(flashCalls[0]!.opts.family).toBe('gba');
    // Slots removed + v2_dest_committed dispatched.
    expect(removeSpy.mock.calls.map((c) => c[0])).toEqual([0, 1]);
    expect(dispatched.find((a) => a.type === 'v2_dest_committed')).toBeDefined();
    expect(dispatched.find((a) => a.type === 'v2_dest_bytes_refreshed')).toBeDefined();
  });

  // AMEND-S8v2.3-8 — flash_failed must NOT mutate slots.
  it('flash_failed → removeAt NEVER called; no v2_dest_committed', async () => {
    const store = new FakeStagingStore();
    store.seed([placedSlot(0, 0), ...Array.from({ length: 29 }, () => null)]);
    const state = destCartState(store);
    const dispatched: Action[] = [];
    const removeSpy = vi.spyOn(store, 'removeAt');
    const { fn: confirmFn } = autoConfirmDialog();

    const flashSpy = vi.fn(
      async (): Promise<CartFlashResult> => ({
        kind: 'failed',
        error: new CartError('WRITE_FAILED', 'verify mismatch'),
        recoveryAvailable: null,
      }),
    );

    await runCommitDestination({
      state,
      dispatch: (a) => dispatched.push(a),
      controller: makeDeps(store),
      flashDeps: { requestPort: async () => ({}) as never } as CartFlasherDeps,
      confirmFlashDialog: confirmFn,
      downloadFn: () => undefined,
      flash: flashSpy,
      composeDest: (() => new Uint8Array(131072).fill(0xee)) as never,
    });

    expect(removeSpy).not.toHaveBeenCalled();
    expect(dispatched.find((a) => a.type === 'v2_dest_committed')).toBeUndefined();
    expect(dispatched.find((a) => a.type === 'flash_failed')).toBeDefined();
  });

  it('in-flight guard: cart_flash_progressing → no-op', async () => {
    const store = new FakeStagingStore();
    store.seed([placedSlot(0, 0), ...Array.from({ length: 29 }, () => null)]);
    const baseState = destCartState(store);
    const state: AppState = {
      ...baseState,
      cartFlash: {
        kind: 'cart_flash_progressing',
        target: 'destination',
        phase: 'flashing',
      },
    };
    const flashSpy = vi.fn();
    const { fn: confirmFn } = autoConfirmDialog();

    await runCommitDestination({
      state,
      dispatch: () => undefined,
      controller: makeDeps(store),
      flashDeps: { requestPort: async () => ({}) as never } as CartFlasherDeps,
      confirmFlashDialog: confirmFn,
      downloadFn: () => undefined,
      flash: flashSpy as never,
    });

    expect(flashSpy).not.toHaveBeenCalled();
  });
});
