/**
 * S8v2.2.1 — render-side test for the LEFT-pane source-tile `is-staged`
 * overlay + `→ T<n>` corner badge.
 *
 * Renders the workbench in source role with two source mons staged
 * (one in box 0 slot 3, one in box 1 slot 7). Asserts:
 *   * the staged source tile gets the `is-staged` class.
 *   * a child `.source-tile-staged-badge` element exists (this is the
 *     production class — symmetric with the right-pane
 *     `transfer-tile-placed-badge`).
 *   * the badge text contains `T<idx+1>` zero-padded (matches the
 *     production `T${(slot+1).padStart(2, '0')}` format from
 *     boxBrowser.ts).
 *   * source tiles NOT in `stagedSourceRefs` get neither the class nor
 *     the badge.
 *   * navigating to box 1 lights up the second staged ref.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderWorkbench, type WorkbenchProps } from '../ui/workbench.js';
import { monRefKey, type MonRef } from '../state.js';
import { makeGen2Mon, makeGen2SaveWithBox0 } from './_helpers/staging.js';
import type { SaveContents, Gen12Pokemon } from '@pokeportal/core';

function noop(): void {
  /* */
}

function emptyStagedSlots(): Array<null> {
  return Array.from({ length: 30 }, () => null);
}

function baseProps(overrides: Partial<WorkbenchProps>): WorkbenchProps {
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
    onLoadCart: noop,
    onLoadSav: noop,
    onSwitchRole: noop,
    onSourceBoxChange: noop,
    onSourceCursorMove: noop,
    onSourceMonClick: noop,
    onDestBoxChange: noop,
    onDestCursorMove: noop,
    onDestSlotClick: noop,
    onTransferTileClick: noop,
    onErrorDismiss: noop,
    onPaneReset: noop,
    onClearTransferBox: noop,
    onDismissTransferBoxFullBanner: noop,
    onDismissTransferPlacementBanner: noop,
    onDismissTransferConvertSkipBanner: noop,
    onDismissTransferPartySkipBanner: noop,
    onDismissStagingMigrationOverflowBanner: noop,
    sourceSelection: [],
    destSelection: [],
    transferSelection: [],
    stagedSlots: emptyStagedSlots(),
    stagedSourceRefs: [],
    stagedSourceTransferSlot: new Map(),
    previewedPlacements: null,
    transferBoxFullBanner: null,
    transferPlacementBanner: null,
    transferConvertSkipBanner: null,
    transferPartySkipBanner: null,
    stagingMigrationOverflowBanner: null,
    multiTabBanner: false,
    ...overrides,
  };
}

/**
 * Build a Crystal save with `mons` in box 0 (slots 0..N) AND `mons1` in
 * box 1 — the helper in `_helpers/staging.ts` only puts mons in box 0,
 * so this test extends it inline.
 */
function makeSaveWithTwoBoxes(
  box0: ReadonlyArray<Gen12Pokemon>,
  box1: ReadonlyArray<Gen12Pokemon>,
): SaveContents {
  const base = makeGen2SaveWithBox0(box0);
  const boxes = base.boxes.slice() as Gen12Pokemon[][];
  boxes[1] = box1.slice() as Gen12Pokemon[];
  return { ...base, boxes };
}

describe('v2 source-tile staged overlay', () => {
  let host: HTMLElement;
  beforeEach(() => {
    document.body.replaceChildren();
    host = document.createElement('div');
    document.body.append(host);
  });

  it('source-tile at storage-box 0 slot 3 has is-staged class + badge with T01', () => {
    // The display `boxIndex` is 1-based in `entriesForBox`: 0 = PARTY,
    // 1 = save.boxes[0], 2 = save.boxes[1]. The MonRef the renderer
    // emits uses 0-based storage indices (`boxIndex - 1`). So a staged
    // ref of `{boxIndex: 0, slot: 3}` corresponds to display box 1
    // slot 3.
    const box0 = Array.from({ length: 5 }, (_, i) =>
      makeGen2Mon({ speciesGen2Id: 158 + i }),
    );
    const box1 = Array.from({ length: 8 }, (_, i) =>
      makeGen2Mon({ speciesGen2Id: 1 + i }),
    );
    const save = makeSaveWithTwoBoxes(box0, box1);
    const stagedRef0: MonRef = { bucket: 'box', boxIndex: 0, slot: 3 };
    const stagedRef1: MonRef = { bucket: 'box', boxIndex: 1, slot: 7 };
    const stagedSourceTransferSlot = new Map<string, number>();
    stagedSourceTransferSlot.set(monRefKey(stagedRef0), 0); // → T01
    stagedSourceTransferSlot.set(monRefKey(stagedRef1), 4); // → T05

    const wb = renderWorkbench(
      baseProps({
        leftRole: 'source',
        sourceLoaded: {
          save,
          boxIndex: 1, // display index 1 == storage save.boxes[0]
          cursor: { row: 0, col: 0 },
          fileName: 'crystal.sav',
        },
        stagedSourceRefs: [stagedRef0, stagedRef1],
        stagedSourceTransferSlot,
      }),
    );
    host.append(wb);

    const tiles = host.querySelectorAll('.box-grid .box-tile');
    // Box 0 storage has 5 mons in slots 0..4, so visibleRows = 2 → 8
    // tiles total. Slot 3 is the staged one.
    const stagedTile = tiles[3] as HTMLElement | undefined;
    expect(stagedTile).toBeDefined();
    expect(stagedTile!.classList.contains('is-staged')).toBe(true);
    const badge = stagedTile!.querySelector('.source-tile-staged-badge');
    expect(badge).not.toBeNull();
    expect(badge!.textContent ?? '').toContain('T01');

    // A non-staged occupied tile (slot 0) has neither.
    const otherTile = tiles[0] as HTMLElement;
    expect(otherTile.classList.contains('is-staged')).toBe(false);
    expect(otherTile.querySelector('.source-tile-staged-badge')).toBeNull();
  });

  it('switching to display box 2 (storage box 1) lights up slot 7 with T05', () => {
    const box0 = Array.from({ length: 5 }, (_, i) =>
      makeGen2Mon({ speciesGen2Id: 158 + i }),
    );
    const box1 = Array.from({ length: 8 }, (_, i) =>
      makeGen2Mon({ speciesGen2Id: 1 + i }),
    );
    const save = makeSaveWithTwoBoxes(box0, box1);
    const stagedRef0: MonRef = { bucket: 'box', boxIndex: 0, slot: 3 };
    const stagedRef1: MonRef = { bucket: 'box', boxIndex: 1, slot: 7 };
    const stagedSourceTransferSlot = new Map<string, number>();
    stagedSourceTransferSlot.set(monRefKey(stagedRef0), 0);
    stagedSourceTransferSlot.set(monRefKey(stagedRef1), 4);

    const wb = renderWorkbench(
      baseProps({
        leftRole: 'source',
        sourceLoaded: {
          save,
          boxIndex: 2, // display index 2 == storage save.boxes[1]
          cursor: { row: 0, col: 0 },
          fileName: 'crystal.sav',
        },
        stagedSourceRefs: [stagedRef0, stagedRef1],
        stagedSourceTransferSlot,
      }),
    );
    host.append(wb);

    const tiles = host.querySelectorAll('.box-grid .box-tile');
    const stagedTile = tiles[7] as HTMLElement | undefined;
    expect(stagedTile).toBeDefined();
    expect(stagedTile!.classList.contains('is-staged')).toBe(true);
    const badge = stagedTile!.querySelector('.source-tile-staged-badge');
    expect(badge).not.toBeNull();
    expect(badge!.textContent ?? '').toContain('T05');
  });
});
