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
import type { Gen3SaveContents, BoxedSlot, SaveFormat3 } from '@pokeportal/core';
import { decodeSlotSummary, decodeGen3String } from '@pokeportal/core';
import { getSpecies } from '@pokeportal/core/internal';
import { dialog } from './dialog.js';
import { el } from './dom.js';
import { spriteImg } from './sprites.js';
import type { DestCursor } from '../state.js';

export const DEST_ROWS = 5;
export const DEST_COLS = 6;
export const DEST_SLOTS_PER_BOX = DEST_ROWS * DEST_COLS; // 30

// Overworld follower-sprite set covers ndex 1..386 (TaTaTaZJJ vendored
// pack — see web/public/sprites/overworld/). Gen 1+2+3 all use the
// same HGSS-style walker chrome.
const HIGHEST_OVERWORLD_SPRITE = 386;

/**
 * Map (game family, in-save wallpaper id) → vendored PNG path.
 *
 * Wallpaper IDs in the save are 0-indexed (0..15 for stock RSE, plus the
 * FRLG-only 12..15 overrides at the same numeric range). PKHeX names the
 * files 1-indexed (`box_wp01rs.png`..`box_wp16rs.png`), which we vendored
 * as `01.png`..`16.png` under `web/public/sprites/wallpapers/{rs,e,frlg}/`.
 *
 * For FRLG saves: PKHeX only ships overrides for 13..16 (1-indexed). Any
 * lower ID falls back to the RS art — the underlying tile data is shared.
 */
function wallpaperPath(format: SaveFormat3, id: number): string {
  const oneIndexed = String(id + 1).padStart(2, '0');
  switch (format) {
    case 'EMERALD':
      return `sprites/wallpapers/e/${oneIndexed}.png`;
    case 'FIRERED':
    case 'LEAFGREEN':
      // Only 13..16 (0-indexed 12..15) are vendored under frlg/; lower IDs
      // share the RS asset.
      return id >= 12
        ? `sprites/wallpapers/frlg/${oneIndexed}.png`
        : `sprites/wallpapers/rs/${oneIndexed}.png`;
    case 'RUBY':
    case 'SAPPHIRE':
    default:
      return `sprites/wallpapers/rs/${oneIndexed}.png`;
  }
}

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

  // Apply the in-game wallpaper for this box as the grid background.
  // Layered with a 55%-white wash on top so the wallpaper reads as faint
  // texture rather than dominant chrome — matches the muted GBA palette.
  const wpId = props.save.pc.wallpapersRaw[props.boxIndex] ?? 0;
  const wpUrl = wallpaperPath(props.save.format, wpId);
  const grid = el('div', {
    class: 'box-grid dest-box-grid',
    style: `background-image: linear-gradient(rgba(248,248,248,0.55), rgba(248,248,248,0.55)), url(${wpUrl});`,
  });
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
        const spriteSet = species > 0 && species <= HIGHEST_OVERWORLD_SPRITE ? 'overworld' : 'gen3';
        const speciesName = getSpecies(species)?.name ?? `species-${species}`;
        tile.append(spriteImg(species, spriteSet, speciesName));
        // Hover tooltip — feature parity with the source-side box browser.
        // Gen 3 box mons are encrypted; decodeSlotSummary handles the
        // PID-shuffle + XOR decrypt and pulls out the tooltip-relevant fields.
        const summary = decodeSlotSummary(slotData.bytes);
        if (summary) {
          tile.append(monTooltip(summary, speciesName));
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

/**
 * Hover popover with the dest mon's front sprite + nickname/species/OT.
 * Feature-mirror of the source-side `monTooltip` in boxBrowser.ts. Plain
 * CSS hover (.box-tile:hover .box-tile-tooltip) — no JS state needed.
 *
 * Nickname/OT decoded via the English Gen 3 charmap; JP carts will
 * render as `?` for non-ASCII bytes (see AMEND-S7a-13).
 */
function monTooltip(
  summary: import('@pokeportal/core').SlotSummary,
  speciesName: string,
): HTMLElement {
  const tip = el('div', { class: 'box-tile-tooltip' });
  const nick = decodeGen3String(summary.nicknameBytes) || speciesName;
  const ot = decodeGen3String(summary.otNameBytes) || '(unknown)';
  const spriteSet =
    summary.species > 0 && summary.species <= HIGHEST_OVERWORLD_SPRITE ? 'gen3' : 'gen3';
  void spriteSet;
  tip.append(spriteImg(summary.species, 'gen3', speciesName));
  const text = el('div', { class: 'tooltip-text' });
  text.append(
    el('div', { class: 'tooltip-line tooltip-nick' }, `${nick}`),
    el('div', { class: 'tooltip-line' }, speciesName),
    el('div', { class: 'tooltip-line tooltip-ot' }, `OT: ${ot} (TID ${summary.tid})`),
  );
  if (summary.shiny) {
    text.append(el('div', { class: 'tooltip-line tooltip-shiny' }, '★ shiny'));
  }
  tip.append(text);
  return tip;
}
