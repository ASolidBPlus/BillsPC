/**
 * S8v2.2.1 — integration test for `runClearTransferBox`.
 *
 * S8v2.3 / AMEND-S8v2.3-5 — UPDATED for the new dialog copy. The prior
 * sprint's `"pending placements"` substring is gone; the new copy splits
 * the count into X uncommitted (safe to clear) and Y source-committed
 * (PERMANENTLY LOST). The Y === 0 path keeps a terse line; the Y > 0
 * path explicitly calls out the permanent-loss case (orchestrator A2).
 *
 * Asserts:
 *   * Y === 0 path → message contains `"7 staged mons"` AND
 *     `"7 uncommitted"` AND the safety phrase ("safe to clear").
 *   * On confirm → `stagingStore.clear()` called exactly once.
 *   * On cancel → `stagingStore.clear()` NOT called.
 *   * When `occupied === 0` → handler early-returns; no dialog opens.
 *   * Y > 0 path → message contains the literal `"PERMANENTLY LOST"`
 *     (the load-bearing user-facing warning).
 *
 * Implementation note — `runClearTransferBox` accepts the confirm
 * dialog as an INJECTED dep (since S8v2.2.1's v2Actions extraction).
 * That avoids any vi.mock of the dialog import + lets the test capture
 * the message string directly. The production wrapper in `ui.ts`
 * passes the JSDOM-mounted `openConfirmDialog`; tests pass a stub.
 */

import { describe, it, expect, vi } from 'vitest';
import { runClearTransferBox } from '../ui/v2Actions.js';
import type { ControllerDeps } from '../ui.js';
import type { AppState } from '../state.js';
import { FakeStagingStore, makeSlot } from './_helpers/staging.js';

function makeDeps(store: FakeStagingStore): ControllerDeps {
  return {
    parseSave: (() => null) as unknown as ControllerDeps['parseSave'],
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

function stateWithStaged(slotsCount: number, withPlacementsCount: number): AppState {
  const slots = Array.from({ length: 30 }, (_, i): ReturnType<typeof makeSlot> | null => {
    if (i >= slotsCount) return null;
    if (i < withPlacementsCount) {
      return makeSlot(i, {
        placement: {
          destBoxIndex: 1,
          destSlot: i,
          destCartLabel: 'POKEMON EMERALD',
          destTid: 99999,
          destFormat: 'rse',
        },
      });
    }
    return makeSlot(i);
  });
  return {
    kind: 'idle',
    staging: {
      slots,
      stagedMons: [],
      rightPaneSubview: 'staging',
      sessionMetadata: { createdAt: 'iso', lastModifiedAt: 'iso' },
    },
  };
}

describe('runClearTransferBox — confirm dialog + clear semantics', () => {
  it('Y === 0: message includes "7 staged mons" + "7 uncommitted" + "safe to clear"', async () => {
    const store = new FakeStagingStore();
    // 7 placed (placement set) but NONE source-committed → Y === 0.
    const state = stateWithStaged(7, 3);
    let capturedMessage: string | null = null;
    const confirmStub = vi.fn(async (msg: string): Promise<boolean> => {
      capturedMessage = msg;
      return true;
    });
    const clearSpy = vi.spyOn(store, 'clear');

    await runClearTransferBox(state, () => undefined, makeDeps(store), confirmStub);

    expect(capturedMessage).not.toBeNull();
    // S8v2.3 / AMEND-S8v2.3-5 — new copy substrings.
    expect(capturedMessage!).toContain('7 staged mons');
    expect(capturedMessage!).toContain('7 uncommitted');
    expect(capturedMessage!).toContain('safe to clear');
    expect(capturedMessage!).toContain('cannot be undone');
    expect(clearSpy).toHaveBeenCalledTimes(1);
  });

  it('on cancel → clear() NOT called', async () => {
    const store = new FakeStagingStore();
    const state = stateWithStaged(3, 0);
    const confirmStub = vi.fn(async (): Promise<boolean> => false);
    const clearSpy = vi.spyOn(store, 'clear');

    await runClearTransferBox(state, () => undefined, makeDeps(store), confirmStub);

    expect(confirmStub).toHaveBeenCalledTimes(1);
    expect(clearSpy).not.toHaveBeenCalled();
  });

  it('occupiedCount === 0 → handler early-returns; no dialog, no clear()', async () => {
    const store = new FakeStagingStore();
    const state: AppState = {
      kind: 'idle',
      staging: {
        slots: Array.from({ length: 30 }, () => null),
        stagedMons: [],
        rightPaneSubview: 'staging',
        sessionMetadata: { createdAt: 'iso', lastModifiedAt: 'iso' },
      },
    };
    const confirmStub = vi.fn(async (): Promise<boolean> => true);
    const clearSpy = vi.spyOn(store, 'clear');

    await runClearTransferBox(state, () => undefined, makeDeps(store), confirmStub);

    expect(confirmStub).not.toHaveBeenCalled();
    expect(clearSpy).not.toHaveBeenCalled();
  });

  // S8v2.3 / AMEND-S8v2.3-5 — when ANY slot is source-committed the dialog
  // MUST loud-warn about permanent loss (orchestrator A2). The substring
  // `PERMANENTLY LOST` is the load-bearing copy gate.
  it('Y > 0: message includes the literal "PERMANENTLY LOST" substring', async () => {
    const store = new FakeStagingStore();
    // 5 occupied slots, 2 of them flagged source-committed.
    const slots: Array<ReturnType<typeof makeSlot> | null> = Array.from(
      { length: 30 },
      () => null,
    );
    for (let i = 0; i < 5; i++) {
      const s = makeSlot(i);
      slots[i] = i < 2 ? { ...s, sourceCommitted: true } : s;
    }
    const state: AppState = {
      kind: 'idle',
      staging: {
        slots,
        stagedMons: [],
        rightPaneSubview: 'staging',
        sessionMetadata: { createdAt: 'iso', lastModifiedAt: 'iso' },
      },
    };
    let capturedMessage: string | null = null;
    const confirmStub = vi.fn(async (msg: string): Promise<boolean> => {
      capturedMessage = msg;
      return false;
    });

    await runClearTransferBox(state, () => undefined, makeDeps(store), confirmStub);

    expect(capturedMessage).not.toBeNull();
    expect(capturedMessage!).toContain('PERMANENTLY LOST');
    expect(capturedMessage!).toContain('5 staged mons');
    expect(capturedMessage!).toContain('3 uncommitted');
    expect(capturedMessage!).toContain('2 source-committed');
  });
});
