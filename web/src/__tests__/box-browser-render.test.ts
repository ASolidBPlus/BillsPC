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

  it('renders the box-browser DOM with Crystal Clear-style overworld sprites for the party', async () => {
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
    expect(grid!.querySelectorAll('.box-tile')).toHaveLength(20);

    // Default boxIndex=0 (PARTY): demo-crystal.sav has 6 party members.
    const occupied = root.querySelectorAll('.box-tile.is-occupied');
    expect(occupied.length).toBe(6);

    // Each occupied tile carries an overworld sprite (rendered as a div with a
    // background-image so CSS keyframes can cycle the walking-frame animation).
    const sprites = root.querySelectorAll('.box-tile.is-occupied .ow-sprite');
    expect(sprites.length).toBe(6);
    for (const s of Array.from(sprites)) {
      const bg = (s as HTMLElement).style.backgroundImage;
      expect(bg).toMatch(/sprites\/overworld\/\d+\.png/);
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
    // Menu has STORE + CANCEL.
    const labels = Array.from(overlay!.querySelectorAll('.gen2-menu-label')).map(
      (e) => e.textContent,
    );
    expect(labels).toEqual(['STORE', 'CANCEL']);
  });
});
