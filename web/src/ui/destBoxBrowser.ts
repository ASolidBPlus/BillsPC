/**
 * S6a destination-side box browser.
 *
 * 14 boxes × 30 slots, laid out as a 5-row × 6-col grid per box. Box
 * names come from the parsed Gen 3 save (decoded via charmap3); empty
 * slots show a faint dot, occupied slots show the species' Gen 3
 * front sprite.
 *
 * Per PLAN_EVAL A9: only sprites for species 1..251 are vendored at
 * `web/public/sprites/gen3/`. Species 252..386 (Hoenn) have no sprite
 * file — we render a "?" placeholder tile to avoid 404 noise. Vendoring
 * 252..386 is tracked as a separate task (see comment below).
 *
 * The browser is read-only — clicking a tile just MOVES the cursor (the
 * actual STORE action lives on the comparison overlay's STORE button,
 * which uses `state.dest.cursor` as the target).
 */
import type { Gen3SaveContents, BoxedSlot } from '@pokeportal/core';
import { dialog } from './dialog.js';
import { el } from './dom.js';
import { spriteImg } from './sprites.js';
import type { DestCursor } from '../state.js';

export const DEST_ROWS = 5;
export const DEST_COLS = 6;
export const DEST_SLOTS_PER_BOX = DEST_ROWS * DEST_COLS; // 30

// TODO: vendor Gen 3 sprites for ndex 252..386 (Treecko..Deoxys) into
// `web/public/sprites/gen3/`. Until then, slots whose species falls in
// that range render a "?" placeholder. This is a pure asset-vendoring
// task — no code changes required once the PNGs land.
const HIGHEST_VENDORED_GEN3_SPRITE = 251;

export interface DestBoxBrowserProps {
  readonly save: Gen3SaveContents;
  readonly boxIndex: number;
  readonly cursor: DestCursor;
  readonly onCursorMove: (drow: -1 | 0 | 1, dcol: -1 | 0 | 1) => void;
  readonly onBoxChange: (delta: -1 | 1) => void;
  readonly onSlotClick: (slotIndex: number) => void;
}

export function destBoxBrowser(props: DestBoxBrowserProps): HTMLElement {
  const wrap = dialog({ class: 'dest-box-browser' });

  // Title row: ◀ <BoxName> ▶
  const title = el('div', { class: 'box-title dest-box-title' });
  const prev = el(
    'button',
    { class: 'box-nav', type: 'button', 'aria-label': 'previous destination box' },
    '◀',
  );
  prev.addEventListener('click', () => props.onBoxChange(-1));
  const next = el(
    'button',
    { class: 'box-nav', type: 'button', 'aria-label': 'next destination box' },
    '▶',
  );
  next.addEventListener('click', () => props.onBoxChange(1));
  const boxName = props.save.boxNames[props.boxIndex] ?? `BOX ${props.boxIndex + 1}`;
  title.append(prev, el('span', { class: 'box-name dest-box-name' }, boxName), next);
  wrap.append(title);

  const box = props.save.pc.boxes[props.boxIndex] ?? [];

  const grid = el('div', { class: 'box-grid dest-box-grid' });
  for (let row = 0; row < DEST_ROWS; row++) {
    for (let col = 0; col < DEST_COLS; col++) {
      const slot = row * DEST_COLS + col;
      const slotData = box[slot] as BoxedSlot | undefined;
      const isCursor = row === props.cursor.row && col === props.cursor.col;
      const filled = slotData?.kind === 'filled';
      const tile = el('div', {
        class:
          'box-tile dest-box-tile' +
          (filled ? ' is-occupied' : ' is-empty') +
          (isCursor ? ' is-cursor' : ''),
        'data-row': String(row),
        'data-col': String(col),
        'data-slot': String(slot),
        ...(filled ? { title: 'occupied' } : {}),
      });
      if (filled) {
        const species = slotData.species;
        if (species > 0 && species <= HIGHEST_VENDORED_GEN3_SPRITE) {
          // HGSS-style overworld follower sprite — same chrome as the source
          // box browser so the two panes read as a matched set.
          tile.append(spriteImg(species, 'overworld', `species ${species}`));
        } else {
          // Placeholder for un-vendored Hoenn species (252..386); no overworld
          // strip available in our vendored set either.
          tile.append(el('span', { class: 'sprite-placeholder' }, '?'));
        }
      } else {
        tile.append(el('span', { class: 'empty-marker' }, '·'));
      }
      tile.addEventListener('click', () => props.onSlotClick(slot));
      grid.append(tile);
    }
  }
  wrap.append(grid);
  return wrap;
}
