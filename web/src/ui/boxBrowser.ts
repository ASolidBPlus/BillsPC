/**
 * Gen 2-style PC box browser. 4-column × 5-row grid of overworld
 * sprites, with a single cursor that can be moved by arrow keys or
 * clicked.
 *
 * Per PLAN_EVAL S5 A8, shiny mons get a 1-px gold outline on the tile.
 *
 * The browser is a pure function of state — the controller passes
 * pre-collected `entries` (the controller knows which save slice to
 * iterate; the browser just renders).
 */
import type { Gen12Pokemon, SaveContents } from '@pokeportal/core';
import { gen2Shiny, getSpecies } from '@pokeportal/core/internal';
import { dialog } from './dialog.js';
import { el } from './dom.js';
import { spriteImg } from './sprites.js';
import type { MonRef } from '../state.js';

export const BROWSER_ROWS = 5;
export const BROWSER_COLS = 4;
export const BROWSER_SLOTS = BROWSER_ROWS * BROWSER_COLS; // 20

export interface BrowserEntry {
  readonly ref: MonRef;
  readonly mon: Gen12Pokemon;
  readonly slotInBox: number; // 0..19
}

export interface BoxBrowserProps {
  readonly save: SaveContents;
  readonly boxIndex: number;
  readonly cursor: { row: number; col: number };
  readonly entries: readonly BrowserEntry[];
  readonly onCursorMove: (drow: -1 | 0 | 1, dcol: -1 | 0 | 1) => void;
  readonly onBoxChange: (delta: -1 | 1) => void;
  readonly onMonOpen: (ref: MonRef) => void;
}

/** Render the box title bar e.g. `◀ BOX 3 ▶` or `◀ PARTY ▶`. */
function boxLabel(save: SaveContents, boxIndex: number): string {
  if (boxIndex === 0) return 'PARTY';
  const stored = save.boxes.length;
  if (boxIndex <= stored) return `BOX ${boxIndex}`;
  return 'CURRENT';
}

export function boxBrowser(props: BoxBrowserProps): HTMLElement {
  const wrap = dialog({ class: 'box-browser' });
  // Title row.
  const title = el('div', { class: 'box-title' });
  const prev = el(
    'button',
    { class: 'box-nav', type: 'button', 'aria-label': 'previous box' },
    '◀',
  );
  prev.addEventListener('click', () => props.onBoxChange(-1));
  const next = el('button', { class: 'box-nav', type: 'button', 'aria-label': 'next box' }, '▶');
  next.addEventListener('click', () => props.onBoxChange(1));
  title.append(prev, el('span', { class: 'box-name' }, boxLabel(props.save, props.boxIndex)), next);
  wrap.append(title);

  // Map slot index -> entry for quick lookup.
  const bySlot = new Map<number, BrowserEntry>();
  for (const e of props.entries) bySlot.set(e.slotInBox, e);

  const grid = el('div', { class: 'box-grid' });
  for (let row = 0; row < BROWSER_ROWS; row++) {
    for (let col = 0; col < BROWSER_COLS; col++) {
      const slot = row * BROWSER_COLS + col;
      const entry = bySlot.get(slot);
      const isCursor = row === props.cursor.row && col === props.cursor.col;
      const tile = el('div', {
        class:
          'box-tile' +
          (entry ? ' is-occupied' : ' is-empty') +
          (isCursor ? ' is-cursor' : '') +
          (entry && gen2Shiny(entry.mon.dvs) ? ' is-shiny' : ''),
        'data-row': String(row),
        'data-col': String(col),
        'data-slot': String(slot),
      });
      if (entry) {
        const ndex = entry.mon.speciesGen2Id;
        const speciesName = getSpecies(ndex)?.name ?? `species-${ndex}`;
        tile.append(spriteImg(ndex, 'overworld', speciesName));
        tile.addEventListener('click', () => props.onMonOpen(entry.ref));
      }
      grid.append(tile);
    }
  }
  wrap.append(grid);
  return wrap;
}

/**
 * Slice the save into the current box's `BrowserEntry[]`. boxIndex 0 is
 * party (max 6 slots in the first row); boxIndex 1..N are stored boxes;
 * boxIndex N+1 (when present) is the live "current" box on Gen 1/2.
 */
export function entriesForBox(save: SaveContents, boxIndex: number): readonly BrowserEntry[] {
  const out: BrowserEntry[] = [];
  if (boxIndex === 0) {
    for (let i = 0; i < save.party.length; i++) {
      out.push({
        ref: { bucket: 'party', slot: i },
        mon: save.party[i]!,
        slotInBox: i,
      });
    }
    return out;
  }
  const stored = save.boxes.length;
  if (boxIndex <= stored) {
    const box = save.boxes[boxIndex - 1]!;
    for (let i = 0; i < box.length; i++) {
      out.push({
        ref: { bucket: 'box', boxIndex: boxIndex - 1, slot: i },
        mon: box[i]!,
        slotInBox: i,
      });
    }
    return out;
  }
  // current box
  if (save.currentBox) {
    for (let i = 0; i < save.currentBox.length; i++) {
      out.push({
        ref: { bucket: 'currentBox', slot: i },
        mon: save.currentBox[i]!,
        slotInBox: i,
      });
    }
  }
  return out;
}

/** Find the entry under the cursor, or null if the cursor sits on an empty slot. */
export function entryAtCursor(
  entries: readonly BrowserEntry[],
  cursor: { row: number; col: number },
): BrowserEntry | null {
  const slot = cursor.row * BROWSER_COLS + cursor.col;
  return entries.find((e) => e.slotInBox === slot) ?? null;
}
