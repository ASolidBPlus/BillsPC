/**
 * S8v2.3 / PLAN §1 criterion 13 — SWITCH-block predicate.
 *
 * The S8v2.2 SWITCH-block was triggered by `stagedSourceRefs.length > 0`.
 * v2.3 refines it to `slots.some(s !== null && !s.sourceCommitted)` so
 * the source-committed/awaiting-place state allows SWITCH (the user has
 * fulfilled the source obligation; they can flip roles to place mons on
 * the dest cart).
 *
 * Asserts via the workbench renderer's SWITCH button:
 *   * Empty transfer box → SWITCH is enabled.
 *   * Uncommitted slot present → SWITCH is disabled (block triggers).
 *   * Slot present but source-committed → SWITCH is enabled (block lifts).
 *   * Mixed slots (one committed + one uncommitted) → SWITCH is disabled.
 */

import { describe, it, expect } from 'vitest';
import { renderWorkbench, type WorkbenchProps } from '../ui/workbench.js';
import { makeSlot } from './_helpers/staging.js';
import type { StagedSlot } from '../cart/stagingStore.types.js';

function baseProps(slots: ReadonlyArray<StagedSlot | null>): WorkbenchProps {
  return {
    leftRole: 'source',
    sourceLoaded: null,
    sourceCartLoading: null,
    sourceSavParsing: null,
    sourceError: null,
    destLoaded: null,
    destCartLoading: null,
    destSavParsing: null,
    destError: null,
    onLoadCart: () => undefined,
    onLoadSav: () => undefined,
    onSwitchRole: () => undefined,
    onSourceBoxChange: () => undefined,
    onSourceCursorMove: () => undefined,
    onSourceMonClick: () => undefined,
    onDestBoxChange: () => undefined,
    onDestCursorMove: () => undefined,
    onDestSlotClick: () => undefined,
    onTransferTileClick: () => undefined,
    onErrorDismiss: () => undefined,
    onPaneReset: () => undefined,
    onClearTransferBox: () => undefined,
    onDismissTransferBoxFullBanner: () => undefined,
    onDismissTransferPlacementBanner: () => undefined,
    onDismissTransferConvertSkipBanner: () => undefined,
    onDismissTransferPartySkipBanner: () => undefined,
    onDismissStagingMigrationOverflowBanner: () => undefined,
    sourceSelection: [],
    destSelection: [],
    transferSelection: [],
    stagedSlots: slots,
    stagedSourceRefs: [],
    stagedSourceTransferSlot: new Map(),
    previewedPlacements: null,
    transferBoxFullBanner: null,
    transferPlacementBanner: null,
    transferConvertSkipBanner: null,
    transferPartySkipBanner: null,
    stagingMigrationOverflowBanner: null,
    multiTabBanner: false,
  };
}

function findSwitchBtn(slots: ReadonlyArray<StagedSlot | null>): HTMLButtonElement {
  const root = renderWorkbench(baseProps(slots));
  const btn = Array.from(root.querySelectorAll('button')).find((b) =>
    b.textContent?.includes('SWITCH TO'),
  );
  if (!btn) throw new Error('SWITCH button not found in rendered workbench');
  return btn as HTMLButtonElement;
}

describe('SWITCH-block predicate (S8v2.3 / criterion 13)', () => {
  it('empty transfer box → SWITCH enabled', () => {
    const slots: ReadonlyArray<StagedSlot | null> = Array.from({ length: 30 }, () => null);
    expect(findSwitchBtn(slots).disabled).toBe(false);
  });

  it('uncommitted staged slot present → SWITCH disabled', () => {
    const slots: Array<StagedSlot | null> = Array.from({ length: 30 }, () => null);
    slots[0] = makeSlot(0); // sourceCommitted defaults to undefined → falsy → counts as uncommitted
    expect(findSwitchBtn(slots).disabled).toBe(true);
  });

  it('only source-committed slots → SWITCH ENABLED (the v2.3 lift)', () => {
    const slots: Array<StagedSlot | null> = Array.from({ length: 30 }, () => null);
    slots[0] = { ...makeSlot(0), sourceCommitted: true };
    slots[1] = { ...makeSlot(1), sourceCommitted: true };
    // S8v2.2 would have left this DISABLED (stagedSourceRefs.length > 0);
    // S8v2.3 lifts the block once every staged slot has had its source
    // commit landed.
    expect(findSwitchBtn(slots).disabled).toBe(false);
  });

  it('mixed: one committed + one uncommitted → SWITCH disabled', () => {
    const slots: Array<StagedSlot | null> = Array.from({ length: 30 }, () => null);
    slots[0] = { ...makeSlot(0), sourceCommitted: true };
    slots[1] = makeSlot(1);
    expect(findSwitchBtn(slots).disabled).toBe(true);
  });
});
