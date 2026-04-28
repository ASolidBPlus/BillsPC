/**
 * jsdom integration test: given a parsed save, the box browser renders
 * the correct overworld sprite paths (PLAN §8.1).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createController, handleFileSelected, DEFAULT_DEPS } from '../ui.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CRYSTAL = resolve(HERE, '../../../tests/fixtures/saves/demo-crystal.sav');

function mkFile(bytes: Uint8Array, name: string): File {
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const f = new File([ab], name, { type: 'application/octet-stream' });
  if (typeof f.arrayBuffer !== 'function') {
    Object.defineProperty(f, 'arrayBuffer', { value: () => Promise.resolve(ab) });
  }
  return f;
}

describe('box browser render (jsdom)', () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.replaceChildren();
    root = document.createElement('div');
    root.id = 'app';
    document.body.appendChild(root);
  });

  it('renders the box-browser DOM with SoupPotato party-icon sprites for the party', async () => {
    const controller = createController(root);
    const bytes = new Uint8Array(readFileSync(CRYSTAL));
    await handleFileSelected(
      mkFile(bytes, 'demo-crystal.sav'),
      (a) => controller.dispatch(a),
      DEFAULT_DEPS,
    );

    expect(controller.state().kind).toBe('loaded');
    const browser = root.querySelector('.box-browser');
    expect(browser).not.toBeNull();
    const grid = root.querySelector('.box-grid');
    expect(grid).not.toBeNull();
    // Box renders only enough rows to cover the highest occupied slot —
    // 6 mons fit in 2 rows × 4 cols = 8 tiles for the PARTY view.
    expect(grid!.querySelectorAll('.box-tile')).toHaveLength(8);

    // Default boxIndex=0 (PARTY): demo-crystal.sav has 6 party members.
    const occupied = root.querySelectorAll('.box-tile.is-occupied');
    expect(occupied.length).toBe(6);

    // Each occupied tile carries a SoupPotato party-icon sprite. Per
    // the iOS Safari fix, the sprite is rendered as <div class="party-
    // icon-gen2"><img class="party-icon-img" src="..."></div> — the
    // wrapper clips a 2-frame strip and the inner img animates via
    // top-position to swap frames (background-image broke retina
    // image-rendering on iOS).
    const sprites = root.querySelectorAll('.box-tile.is-occupied .party-icon-gen2');
    expect(sprites.length).toBe(6);
    for (const s of Array.from(sprites)) {
      const inner = s.querySelector('img.party-icon-img') as HTMLImageElement | null;
      expect(inner).not.toBeNull();
      expect(inner!.getAttribute('src')).toMatch(/sprites\/party-gen2\/\d+\.png/);
    }
  });

  it('renders BOX label PARTY at boxIndex 0 and switches to BOX 1 on box_change', async () => {
    const controller = createController(root);
    const bytes = new Uint8Array(readFileSync(CRYSTAL));
    await handleFileSelected(
      mkFile(bytes, 'demo-crystal.sav'),
      (a) => controller.dispatch(a),
      DEFAULT_DEPS,
    );
    expect(root.querySelector('.box-name')!.textContent).toBe('PARTY');
    controller.dispatch({ type: 'box_change', delta: 1 });
    expect(root.querySelector('.box-name')!.textContent).toBe('BOX 1');
  });

  it('cursor outline follows the cursor on cursor_move', async () => {
    const controller = createController(root);
    const bytes = new Uint8Array(readFileSync(CRYSTAL));
    await handleFileSelected(
      mkFile(bytes, 'demo-crystal.sav'),
      (a) => controller.dispatch(a),
      DEFAULT_DEPS,
    );
    let cursor = root.querySelector('.box-tile.is-cursor')!;
    expect(cursor.getAttribute('data-row')).toBe('0');
    expect(cursor.getAttribute('data-col')).toBe('0');
    controller.dispatch({ type: 'cursor_move', drow: 1, dcol: 1 });
    controller.dispatch({ type: 'cursor_move', drow: 0, dcol: 1 });
    cursor = root.querySelector('.box-tile.is-cursor')!;
    expect(cursor.getAttribute('data-row')).toBe('1');
    expect(cursor.getAttribute('data-col')).toBe('2');
  });

  it('clicking an occupied tile dispatches mon_open and renders the comparison overlay', async () => {
    const controller = createController(root);
    const bytes = new Uint8Array(readFileSync(CRYSTAL));
    await handleFileSelected(
      mkFile(bytes, 'demo-crystal.sav'),
      (a) => controller.dispatch(a),
      DEFAULT_DEPS,
    );
    const firstOccupied = root.querySelector('.box-tile.is-occupied') as HTMLElement;
    expect(firstOccupied).not.toBeNull();
    firstOccupied.click();
    const overlay = root.querySelector('.comparison-overlay');
    expect(overlay).not.toBeNull();
    // Both panes present.
    expect(overlay!.querySelector('.status-screen--gen12')).not.toBeNull();
    expect(overlay!.querySelector('.status-screen--gen3')).not.toBeNull();
    // S6a: menu now has STORE in destination (disabled when no dest is
    // loaded, per orchestrator Q3) + Download .pk3 + CANCEL.
    const labels = Array.from(overlay!.querySelectorAll('.gen2-menu-label')).map(
      (e) => e.textContent,
    );
    expect(labels).toEqual(['STORE in destination', 'Download .pk3', 'CANCEL']);
    // The STORE-in-destination row is disabled (no dest loaded) and
    // carries the discoverability tooltip.
    const disabledRow = overlay!.querySelector('.gen2-menu-row.is-disabled');
    expect(disabledRow).not.toBeNull();
    expect(disabledRow!.getAttribute('title')).toContain('Load a destination');
  });
});
