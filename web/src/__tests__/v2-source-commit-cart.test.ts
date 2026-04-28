/**
 * S8v2.3 — `runCommitSource` cart-mode path.
 *
 * Asserts:
 *   * Typed-PROCEED gate is enforced — confirmFlashDialog is mounted
 *     and the user must click Commit before flashCart fires.
 *   * `flashCart` is invoked with the composed bytes + the cart's
 *     CURRENT bytes as `cartCurrentBytes` (per AMEND-S7b-HIL-5).
 *   * On success → `setSourceCommitted` flips slots; v2_source_committed
 *     dispatched; v2_source_bytes_refreshed dispatched.
 *   * On failure (AMEND-S8v2.3-8) → setSourceCommitted is NEVER called;
 *     v2_source_committed is NEVER dispatched; flash_failed IS dispatched
 *     so the existing recovery dialog renders unchanged.
 *   * Entry guard (AMEND-S8v2.3-7): state.kind !== 'loaded' → no-op.
 */

import { describe, it, expect, vi } from 'vitest';
import { runCommitSource } from '../ui/v2Actions.js';
import type { ControllerDeps } from '../ui.js';
import type { Action, AppState } from '../state.js';
import type { CartFlasherDeps, CartFlashResult } from '../cart/cartFlasher.js';
import { CartError } from '@pokeportal/core';
import { FakeStagingStore, makeGen2SaveWithBox0, makeSlot } from './_helpers/staging.js';

function makeDeps(store: FakeStagingStore): ControllerDeps {
  return {
    parseSave: ((_bytes: Uint8Array) =>
      makeGen2SaveWithBox0([])) as unknown as ControllerDeps['parseSave'],
    convert: (() => null) as unknown as ControllerDeps['convert'],
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

/** Same trick as v2-source-commit-sav.test — minimally-valid CRYSTAL
 *  SRAM so the gen2 deleter works on the staged box-0 slots. */
function makeValidCrystalBytesFor(monCount: number): Uint8Array {
  const out = new Uint8Array(32768);
  const box0Off = 0x4000;
  out[box0Off] = monCount;
  for (let i = 0; i < monCount; i++) out[box0Off + 1 + i] = 158 + i;
  out[box0Off + 1 + monCount] = 0xff;
  return out;
}

function cartLoadedState(store: FakeStagingStore): AppState {
  return {
    kind: 'loaded',
    fileName: 'pokemon-crystal.sav',
    save: makeGen2SaveWithBox0([]),
    sourceBytes: makeValidCrystalBytesFor(2),
    results: new Map(),
    boxIndex: 0,
    cursor: { row: 0, col: 0 },
    openMon: null,
    cartConnection: { variant: 'lesserkuma', deviceId: 'POKEMON CRYSTAL (32 KB)' },
    staging: {
      slots: store.getAllSlots(),
      stagedMons: [],
      rightPaneSubview: 'staging',
      sessionMetadata: { createdAt: 'iso', lastModifiedAt: 'iso' },
    },
  };
}

/** Mount-point confirm dialog stub — captures the props and immediately
 *  fires `onConfirm` for the happy-path tests. Returns a div so the
 *  handler's `.remove()` call works. */
function autoConfirmDialog(): {
  spy: ReturnType<typeof vi.fn>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fn: any;
} {
  const spy = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fn = (props: any): HTMLElement => {
    spy(props);
    queueMicrotask(() => props.onConfirm());
    return document.createElement('div');
  };
  return { spy, fn };
}

function autoCancelDialog(): {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fn: any;
} {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fn = (props: any): HTMLElement => {
    queueMicrotask(() => props.onCancel());
    return document.createElement('div');
  };
  return { fn };
}

describe('runCommitSource — cart mode (S8v2.3)', () => {
  it('typed-PROCEED gate fires + flashCart invoked + slots flipped on ok', async () => {
    const store = new FakeStagingStore();
    store.seed([makeSlot(0), makeSlot(1), ...Array.from({ length: 28 }, () => null)]);
    const state = cartLoadedState(store);
    const dispatched: Action[] = [];
    const flipSpy = vi.spyOn(store, 'setSourceCommitted');
    const { spy: dialogSpy, fn: confirmFn } = autoConfirmDialog();

    const flashCalls: Array<{ deps: unknown; opts: Record<string, unknown> }> = [];
    const flashSpy = vi.fn(
      async (
        flashDepsArg: unknown,
        flashOpts: Record<string, unknown>,
      ): Promise<CartFlashResult> => {
        flashCalls.push({ deps: flashDepsArg, opts: flashOpts });
        return {
          kind: 'ok',
          verifiedBytes: new Uint8Array(32768).fill(0xcd),
        };
      },
    );
    const flashDeps: CartFlasherDeps = { requestPort: async () => ({}) as never };

    await runCommitSource({
      state,
      dispatch: (a) => dispatched.push(a),
      controller: makeDeps(store),
      flashDeps,
      confirmFlashDialog: confirmFn,
      downloadFn: () => undefined,
      flash: flashSpy as never,
      // Stub composeSource — see v2-source-commit-sav.test for rationale.
      composeSource: ((bytes: Uint8Array) => new Uint8Array(bytes).fill(0xcc)) as never,
    });

    // Dialog mounted exactly once with action='WITH COMMIT'.
    expect(dialogSpy).toHaveBeenCalledTimes(1);
    expect(dialogSpy.mock.calls[0]![0].action).toBe('WITH COMMIT');
    // flashCart received the cart's current bytes (not the modified bytes).
    expect(flashSpy).toHaveBeenCalledTimes(1);
    expect(flashCalls).toHaveLength(1);
    const opts = flashCalls[0]!.opts;
    const sourceBytes =
      state.kind === 'loaded' ? state.sourceBytes : new Uint8Array(0);
    expect(opts.cartCurrentBytes).toBe(sourceBytes);
    expect(opts.family).toBe('gbc');
    // Slots flipped + v2_source_committed dispatched.
    expect(flipSpy.mock.calls.map((c) => c[0])).toEqual([0, 1]);
    expect(dispatched.find((a) => a.type === 'v2_source_committed')).toBeDefined();
    expect(dispatched.find((a) => a.type === 'flash_succeeded')).toBeDefined();
  });

  // AMEND-S8v2.3-8 — no slot mutation when flashCart returns failed.
  it('flash_failed → setSourceCommitted NEVER called; no v2_source_committed', async () => {
    const store = new FakeStagingStore();
    store.seed([makeSlot(0), ...Array.from({ length: 29 }, () => null)]);
    const state = cartLoadedState(store);
    const dispatched: Action[] = [];
    const flipSpy = vi.spyOn(store, 'setSourceCommitted');
    const { fn: confirmFn } = autoConfirmDialog();

    const flashSpy = vi.fn(
      async (): Promise<CartFlashResult> => ({
        kind: 'failed',
        error: new CartError('WRITE_FAILED', 'verify mismatch at 0x1000'),
        recoveryAvailable: {
          backupFilename: 'POKEMON-CRYSTAL.backup-pre-x.sav',
          backupBytes: new Uint8Array(32768),
        },
      }),
    );
    const flashDeps: CartFlasherDeps = { requestPort: async () => ({}) as never };

    await runCommitSource({
      state,
      dispatch: (a) => dispatched.push(a),
      controller: makeDeps(store),
      flashDeps,
      confirmFlashDialog: confirmFn,
      downloadFn: () => undefined,
      flash: flashSpy,
    });

    expect(flipSpy).not.toHaveBeenCalled();
    expect(dispatched.find((a) => a.type === 'v2_source_committed')).toBeUndefined();
    // flash_failed IS dispatched so the existing recovery dialog renders.
    const failed = dispatched.find((a) => a.type === 'flash_failed');
    expect(failed).toBeDefined();
    expect((failed as { recoveryAvailable: unknown }).recoveryAvailable).toBeDefined();
  });

  it('user clicks Cancel on the dialog → flashCart NEVER invoked + no slot mutation', async () => {
    const store = new FakeStagingStore();
    store.seed([makeSlot(0), ...Array.from({ length: 29 }, () => null)]);
    const state = cartLoadedState(store);
    const flipSpy = vi.spyOn(store, 'setSourceCommitted');
    const { fn: cancelFn } = autoCancelDialog();
    const flashSpy = vi.fn();

    await runCommitSource({
      state,
      dispatch: () => undefined,
      controller: makeDeps(store),
      flashDeps: { requestPort: async () => ({}) as never },
      confirmFlashDialog: cancelFn,
      downloadFn: () => undefined,
      flash: flashSpy as never,
    });

    expect(flashSpy).not.toHaveBeenCalled();
    expect(flipSpy).not.toHaveBeenCalled();
  });

  // AMEND-S8v2.3-7 entry guard.
  it('entry guard: state.kind !== "loaded" → no-op', async () => {
    const store = new FakeStagingStore();
    store.seed([makeSlot(0), ...Array.from({ length: 29 }, () => null)]);
    const flashSpy = vi.fn();
    const { fn: confirmFn } = autoConfirmDialog();

    await runCommitSource({
      state: { kind: 'idle' },
      dispatch: () => undefined,
      controller: makeDeps(store),
      flashDeps: { requestPort: async () => ({}) as never },
      confirmFlashDialog: confirmFn,
      downloadFn: () => undefined,
      flash: flashSpy as never,
    });

    expect(flashSpy).not.toHaveBeenCalled();
  });

  // AMEND-S8v2.3-6 in-flight guard.
  it('in-flight guard: cartFlash.kind === cart_flash_progressing → no-op', async () => {
    const store = new FakeStagingStore();
    store.seed([makeSlot(0), ...Array.from({ length: 29 }, () => null)]);
    const state: AppState = {
      ...cartLoadedState(store),
      cartFlash: {
        kind: 'cart_flash_progressing',
        target: 'source',
        phase: 'flashing',
      },
    };
    const flashSpy = vi.fn();
    const { fn: confirmFn } = autoConfirmDialog();

    await runCommitSource({
      state,
      dispatch: () => undefined,
      controller: makeDeps(store),
      flashDeps: { requestPort: async () => ({}) as never },
      confirmFlashDialog: confirmFn,
      downloadFn: () => undefined,
      flash: flashSpy as never,
    });

    expect(flashSpy).not.toHaveBeenCalled();
  });
});
