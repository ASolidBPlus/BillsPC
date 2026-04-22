/**
 * S6a — Destination box browser render test.
 *
 * Pinned coverage:
 *   - renders 30 tiles in a 5×6 grid
 *   - filled vs empty tile classes
 *   - cursor outline
 *   - placeholder for un-vendored Gen 3 sprite range (252..386)
 *   - "occupied" tooltip on filled tiles
 *   - clicking dispatches the slot index back
 */
import { describe, it, expect } from 'vitest';
import { destBoxBrowser } from '../ui/destBoxBrowser.js';
import type { Gen3SaveContents } from '@pokeportal/core';

function fakeSave(
  filledByBox: { [boxIdx: number]: { slot: number; species: number }[] } = {},
): Gen3SaveContents {
  type AnySlot = { kind: 'empty' } | { kind: 'filled'; bytes: Uint8Array; species: number };
  const boxes = Array.from({ length: 14 }, (_, b) => {
    const slots: AnySlot[] = Array.from({ length: 30 }, () => ({ kind: 'empty' }));
    for (const f of filledByBox[b] ?? []) {
      slots[f.slot] = { kind: 'filled', bytes: new Uint8Array(80), species: f.species };
    }
    return slots;
  });
  return {
    kind: 'gen3_save',
    format: 'EMERALD',
    family: 'EMERALD',
    bytes: new Uint8Array(131072),
    active: {
      slotIndex: 0,
      slotOffset: 0,
      saveIndex: 1,
      sectorOrder: new Map(),
      checksumsValid: true,
      singleSlot: false,
      inactiveSlotOffset: 0xe000,
    },
    trainer: {
      otNameBytes: new Uint8Array(7),
      tid: 0,
      sid: 0,
      gameCode: 0xbcf3_4f1f,
    },
    pc: {
      currentBox: 0,
      boxes,
      boxNamesRaw: new Uint8Array(126),
      wallpapersRaw: new Uint8Array(14),
    },
    boxNames: [
      'BOX 1',
      'LEGENDS',
      'BOX 3',
      'BOX 4',
      'BOX 5',
      'BOX 6',
      'BOX 7',
      'BOX 8',
      'BOX 9',
      'BOX 10',
      'BOX 11',
      'BOX 12',
      'BOX 13',
      'BOX 14',
    ],
    warnings: [],
  };
}

describe('destBoxBrowser', () => {
  it('renders 30 tiles in a 5×6 grid', () => {
    const el = destBoxBrowser({
      save: fakeSave(),
      boxIndex: 0,
      cursor: { row: 0, col: 0 },
      onCursorMove: () => {},
      onBoxChange: () => {},
      onSlotClick: () => {},
    });
    document.body.replaceChildren(el);
    const tiles = el.querySelectorAll('.box-tile.dest-box-tile');
    expect(tiles.length).toBe(30);
  });

  it('renders the decoded box name in the title', () => {
    const el = destBoxBrowser({
      save: fakeSave(),
      boxIndex: 1,
      cursor: { row: 0, col: 0 },
      onCursorMove: () => {},
      onBoxChange: () => {},
      onSlotClick: () => {},
    });
    expect(el.querySelector('.dest-box-name')?.textContent).toBe('LEGENDS');
  });

  it('marks filled tiles with .is-occupied + tooltip; empty tiles with .is-empty', () => {
    const el = destBoxBrowser({
      save: fakeSave({ 0: [{ slot: 5, species: 7 }] }),
      boxIndex: 0,
      cursor: { row: 0, col: 0 },
      onCursorMove: () => {},
      onBoxChange: () => {},
      onSlotClick: () => {},
    });
    const tiles = Array.from(el.querySelectorAll('.box-tile.dest-box-tile'));
    expect(tiles[0]?.classList.contains('is-empty')).toBe(true);
    expect(tiles[5]?.classList.contains('is-occupied')).toBe(true);
    expect(tiles[5]?.getAttribute('title')).toBe('occupied');
  });

  it('renders overworld sprite for species ≤ 251 (vendored), placeholder otherwise', () => {
    const el = destBoxBrowser({
      save: fakeSave({
        0: [
          { slot: 0, species: 7 },
          { slot: 1, species: 254 },
        ],
      }),
      boxIndex: 0,
      cursor: { row: 0, col: 0 },
      onCursorMove: () => {},
      onBoxChange: () => {},
      onSlotClick: () => {},
    });
    const tiles = Array.from(el.querySelectorAll('.box-tile.dest-box-tile'));
    // Slot 0: species 7 (Squirtle) → overworld sprite tile (background-image
    // div, matches the source browser's chrome).
    expect(tiles[0]?.querySelector('.ow-sprite')).not.toBeNull();
    // Slot 1: species 254 (Sceptile) → placeholder span, no sprite tile.
    expect(tiles[1]?.querySelector('.ow-sprite')).toBeNull();
    expect(tiles[1]?.querySelector('.sprite-placeholder')?.textContent).toBe('?');
  });

  it('cursor tile carries .is-cursor', () => {
    const el = destBoxBrowser({
      save: fakeSave(),
      boxIndex: 0,
      cursor: { row: 2, col: 3 },
      onCursorMove: () => {},
      onBoxChange: () => {},
      onSlotClick: () => {},
    });
    const tiles = Array.from(el.querySelectorAll('.box-tile.dest-box-tile'));
    const cursorTile = tiles[2 * 6 + 3];
    expect(cursorTile?.classList.contains('is-cursor')).toBe(true);
  });

  it('clicking a tile invokes onSlotClick with the right slot index', () => {
    let clicked: number | null = null;
    const el = destBoxBrowser({
      save: fakeSave(),
      boxIndex: 0,
      cursor: { row: 0, col: 0 },
      onCursorMove: () => {},
      onBoxChange: () => {},
      onSlotClick: (slot) => {
        clicked = slot;
      },
    });
    const tile = el.querySelectorAll('.box-tile.dest-box-tile')[14] as HTMLElement;
    tile.click();
    expect(clicked).toBe(14);
  });

  it('prev/next box buttons fire delta -1 / +1', () => {
    const deltas: number[] = [];
    const el = destBoxBrowser({
      save: fakeSave(),
      boxIndex: 5,
      cursor: { row: 0, col: 0 },
      onCursorMove: () => {},
      onBoxChange: (d) => deltas.push(d),
      onSlotClick: () => {},
    });
    const buttons = el.querySelectorAll('.box-nav');
    (buttons[0] as HTMLButtonElement).click();
    (buttons[1] as HTMLButtonElement).click();
    expect(deltas).toEqual([-1, 1]);
  });
});
