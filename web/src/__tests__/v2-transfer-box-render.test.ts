/**
 * S8v2.2 — TRANSFER BOX render tests.
 *
 * Asserts:
 *   * staged mons render at their `slot.idx` position (NOT in append
 *     order — populate slots [3, 7, 12] and assert tiles render at
 *     those positions, others empty).
 *   * tile classes: `is-occupied` / `is-empty` / `is-selected` /
 *     `is-placed`.
 *   * read-only in source role (no click handler attached); clickable
 *     in destination role.
 *   * `is-placed` arrow badge renders for slots with placement.
 */

import { describe, it, expect } from 'vitest';
import { renderWorkbench, type WorkbenchProps } from '../ui/workbench.js';
import type { StagedSlot } from '../cart/stagingStore.types.js';
import type { MonRef } from '../state.js';

function noop(): void {
  /* */
}

function emptySlots(): Array<StagedSlot | null> {
  return Array.from({ length: 30 }, () => null);
}

function makeSlot(idx: number, withPlacement = false): StagedSlot {
  return {
    idx,
    pkBytes: new Uint8Array([0xfe, idx]),
    speciesId: 158 + idx,
    nicknameDisplay: `MON${idx}`,
    sourceCartLabel: 'POKEMON CRYSTAL',
    sourceTid: 12345,
    sourceFamily: 'gen2',
    sourceOtName: 'JOEL',
    sourceRef: { bucket: 'box', boxIndex: 0, slot: idx },
    sourceRefKey: `POKEMON CRYSTAL|12345|box:0:${idx}`,
    stagedAt: `2026-04-25T10:00:00.${idx}Z`,
    placement: withPlacement
      ? {
          destBoxIndex: 1,
          destSlot: 6,
          destCartLabel: 'POKEMON EMERALD',
          destTid: 99999,
          destFormat: 'rse' as const,
        }
      : null,
  };
}

function baseProps(overrides: Partial<WorkbenchProps> = {}): WorkbenchProps {
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
    stagedSlots: emptySlots(),
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

describe('TRANSFER BOX render', () => {
  let host: HTMLElement;
  beforeEach(() => {
    document.body.replaceChildren();
    host = document.createElement('div');
    document.body.append(host);
  });

  it('renders staged mons at their slot.idx position (not append order)', () => {
    const slots = emptySlots();
    slots[3] = makeSlot(3);
    slots[7] = makeSlot(7);
    slots[12] = makeSlot(12);
    const wb = renderWorkbench(baseProps({ stagedSlots: slots }));
    host.append(wb);
    const transfer = host.querySelector('.transfer-box-grid');
    expect(transfer).not.toBeNull();
    const tiles = Array.from(transfer!.querySelectorAll('.box-tile'));
    expect(tiles.length).toBe(30);
    expect(tiles[0]?.classList.contains('is-empty')).toBe(true);
    expect(tiles[3]?.classList.contains('is-occupied')).toBe(true);
    expect(tiles[7]?.classList.contains('is-occupied')).toBe(true);
    expect(tiles[12]?.classList.contains('is-occupied')).toBe(true);
    expect(tiles[4]?.classList.contains('is-empty')).toBe(true);
  });

  it('renders is-selected on tiles whose idx is in transferSelection', () => {
    const slots = emptySlots();
    slots[0] = makeSlot(0);
    slots[1] = makeSlot(1);
    const wb = renderWorkbench(
      baseProps({
        leftRole: 'destination',
        stagedSlots: slots,
        transferSelection: [1],
      }),
    );
    host.append(wb);
    const tiles = Array.from(host.querySelectorAll('.transfer-box-grid .box-tile'));
    expect(tiles[0]?.classList.contains('is-selected')).toBe(false);
    expect(tiles[1]?.classList.contains('is-selected')).toBe(true);
  });

  it('renders is-placed + arrow badge for slots with placement', () => {
    const slots = emptySlots();
    slots[2] = makeSlot(2, true);
    const wb = renderWorkbench(baseProps({ stagedSlots: slots }));
    host.append(wb);
    const tile2 = host.querySelectorAll('.transfer-box-grid .box-tile')[2] as HTMLElement;
    expect(tile2.classList.contains('is-placed')).toBe(true);
    const badge = tile2.querySelector('.transfer-tile-placed-badge');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toContain('B2');
    expect(badge?.textContent).toContain('S07');
  });

  it('source role: tile click DOES call onTransferTileClick (S8v2.2-polish: opens stat modal)', () => {
    // S8v2.2-polish — plain click on a transfer-box tile in EITHER role
    // fires onTransferTileClick. The controller decides what to do:
    // open the stat-screen modal (read-only) regardless of role; in
    // dest role, modifier keys ALSO drive selection toggling.
    const slots = emptySlots();
    slots[0] = makeSlot(0);
    let calls = 0;
    const wb = renderWorkbench(
      baseProps({
        leftRole: 'source',
        stagedSlots: slots,
        onTransferTileClick: () => {
          calls += 1;
        },
      }),
    );
    host.append(wb);
    const tile = host.querySelector('.transfer-box-grid .box-tile.is-occupied') as HTMLElement;
    tile.click();
    expect(calls).toBe(1);
  });

  it('destination role: tile click invokes onTransferTileClick with idx + modKeys', () => {
    const slots = emptySlots();
    slots[5] = makeSlot(5);
    let lastIdx: number | null = null;
    let lastModKeys: { meta: boolean; ctrl: boolean; shift: boolean } | null = null;
    const wb = renderWorkbench(
      baseProps({
        leftRole: 'destination',
        stagedSlots: slots,
        onTransferTileClick: (idx, modKeys) => {
          lastIdx = idx;
          lastModKeys = modKeys;
        },
      }),
    );
    host.append(wb);
    const tile = host.querySelectorAll('.transfer-box-grid .box-tile')[5] as HTMLElement;
    tile.click();
    expect(lastIdx).toBe(5);
    expect(lastModKeys).toEqual({ meta: false, ctrl: false, shift: false });
  });

  it('Clear Transfer Box button is disabled when staging is empty', () => {
    const wb = renderWorkbench(baseProps({ leftRole: 'destination' }));
    host.append(wb);
    const btn = host.querySelector('.wb-clear-transfer-box') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBe(true);
  });

  it('Clear Transfer Box button is enabled when at least one slot is occupied', () => {
    const slots = emptySlots();
    slots[0] = makeSlot(0);
    const wb = renderWorkbench(baseProps({ stagedSlots: slots }));
    host.append(wb);
    const btn = host.querySelector('.wb-clear-transfer-box') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });
});

describe('TRANSFER BOX banners', () => {
  let host: HTMLElement;
  beforeEach(() => {
    document.body.replaceChildren();
    host = document.createElement('div');
    document.body.append(host);
  });

  it('multi-tab banner renders ABOVE the TRANSFER BOX label', () => {
    const wb = renderWorkbench(baseProps({ multiTabBanner: true }));
    host.append(wb);
    const banner = host.querySelector('.multi-tab-banner');
    const label = host.querySelector('.wb-pane-right .wb-pane-label');
    expect(banner).not.toBeNull();
    expect(label).not.toBeNull();
    // Banner is in a sibling position before the label within the right pane.
    const right = host.querySelector('.wb-pane-right')!;
    const banners = right.querySelector('.transfer-box-banners');
    expect(banners).not.toBeNull();
    // Compare DOM order via compareDocumentPosition: banners block precedes label.
    const cmp = banners!.compareDocumentPosition(label!);
    expect(cmp & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('all four banner cards render when their fields are set', () => {
    const wb = renderWorkbench(
      baseProps({
        multiTabBanner: true,
        stagingMigrationOverflowBanner: { dropped: 2 },
        transferBoxFullBanner: { skipped: 3 },
        transferPlacementBanner: { unplaced: 1 },
        transferConvertSkipBanner: { skipped: 4 },
      }),
    );
    host.append(wb);
    expect(host.querySelector('.multi-tab-banner')).not.toBeNull();
    expect(host.querySelector('.staging-migration-overflow-banner')).not.toBeNull();
    expect(host.querySelector('.transfer-box-full-banner')).not.toBeNull();
    expect(host.querySelector('.transfer-placement-banner')).not.toBeNull();
    expect(host.querySelector('.transfer-convert-skip-banner')).not.toBeNull();
  });

  it('dismiss button on transfer-box-full banner calls handler', () => {
    let called = 0;
    const wb = renderWorkbench(
      baseProps({
        transferBoxFullBanner: { skipped: 3 },
        onDismissTransferBoxFullBanner: () => {
          called += 1;
        },
      }),
    );
    host.append(wb);
    const btn = host.querySelector(
      '.transfer-box-full-banner .transfer-box-banner-dismiss',
    ) as HTMLButtonElement;
    btn.click();
    expect(called).toBe(1);
  });
});

// AMEND-S8v2.2-8 — sprite for staged Gen 1/2 mons uses POST-CONVERSION ndex.
describe('Post-conversion sprite (AMEND-S8v2.2-8)', () => {
  let host: HTMLElement;
  beforeEach(() => {
    document.body.replaceChildren();
    host = document.createElement('div');
    document.body.append(host);
  });

  it('renders sprite for slot.speciesId (the post-conversion id)', () => {
    // Mew-glitch routing case: source ndex would have been 200 but
    // convert() returned a different id; the slot freezes the
    // post-conversion species and the renderer reads from there.
    const slots = emptySlots();
    slots[0] = { ...makeSlot(0), speciesId: 25 }; // Pikachu post-conv
    const wb = renderWorkbench(baseProps({ stagedSlots: slots }));
    host.append(wb);
    const tile = host.querySelectorAll('.transfer-box-grid .box-tile')[0] as HTMLElement;
    const img = tile.querySelector('.party-icon-img') as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toMatch(/sprites\/party-gen3\/25\.png/);
  });
});

// vitest helper — used in the per-test beforeEach setup.
import { beforeEach } from 'vitest';
void [{ ref: { bucket: 'box', slot: 0 } as MonRef }];
