/**
 * Shiny indicator (PLAN_EVAL S5 A8 / A14).
 *
 * SPARKY the shiny Raichu (party slot 1 in `tests/fixtures/saves/
 * demo-crystal.sav`) is the canonical shiny test fixture. Per A8:
 *   - the box browser tile gets a 1-px gold outline
 *     (`.box-tile.is-shiny`)
 *   - the comparison view's status-screen header carries a
 *     `.shiny-star` element with the `★` glyph in both Gen 1/2 and
 *     Gen 3 panes.
 *
 * Asserting on commit `9c2460c`: the constructive PID search makes
 * SPARKY round-trip without hitting the hardcap, so the comparison
 * overlay opens cleanly without a refusal.
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

describe('shiny indicator (PLAN_EVAL S5 A8)', () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.replaceChildren();
    root = document.createElement('div');
    root.id = 'app';
    document.body.appendChild(root);
  });

  it('SPARKY (party slot 1) renders with .is-shiny outline on the box tile', async () => {
    const controller = createController(root);
    const bytes = new Uint8Array(readFileSync(CRYSTAL));
    await handleFileSelected(
      mkFile(bytes, 'demo-crystal.sav'),
      (a) => controller.dispatch(a),
      DEFAULT_DEPS,
    );
    // Default boxIndex 0 is PARTY. SPARKY is at slot 1 → row 0 col 1.
    const tile = root.querySelector('.box-tile[data-slot="1"]')!;
    expect(tile.classList.contains('is-shiny')).toBe(true);
    // Sanity: the species under that tile is Raichu (#26 → ndex 26). The
    // sprite is rendered as <div class="party-icon-gen2"><img class=
    // "party-icon-img" src="..."></div> — wrapper clips a 2-frame
    // strip, inner img animates via top-position. Asserting on the
    // inner img src.
    const partyIcon = tile.querySelector('.party-icon-gen2') as HTMLElement | null;
    expect(partyIcon).not.toBeNull();
    const innerImg = partyIcon!.querySelector('img.party-icon-img') as HTMLImageElement | null;
    expect(innerImg).not.toBeNull();
    expect(innerImg!.getAttribute('src')).toContain('sprites/party-gen2/26.png');
  });

  it('opening SPARKY shows ★ in both Gen 1/2 and Gen 3 status headers', async () => {
    const controller = createController(root);
    const bytes = new Uint8Array(readFileSync(CRYSTAL));
    await handleFileSelected(
      mkFile(bytes, 'demo-crystal.sav'),
      (a) => controller.dispatch(a),
      DEFAULT_DEPS,
    );
    // Programmatically open SPARKY via the controller.
    controller.dispatch({ type: 'mon_open', ref: { bucket: 'party', slot: 1 } });
    const overlay = root.querySelector('.comparison-overlay')!;
    expect(overlay).not.toBeNull();
    const stars = overlay.querySelectorAll('.shiny-star');
    expect(stars.length).toBe(2); // one in each pane's header
    for (const s of Array.from(stars)) {
      expect(s.textContent).toBe('★');
    }
  });

  it('non-shiny mons do NOT render .is-shiny or .shiny-star', async () => {
    const controller = createController(root);
    const bytes = new Uint8Array(readFileSync(CRYSTAL));
    await handleFileSelected(
      mkFile(bytes, 'demo-crystal.sav'),
      (a) => controller.dispatch(a),
      DEFAULT_DEPS,
    );
    // Slot 0 is BLAZOR (#157 Typhlosion), not shiny.
    const tile = root.querySelector('.box-tile[data-slot="0"]')!;
    expect(tile.classList.contains('is-shiny')).toBe(false);
    controller.dispatch({ type: 'mon_open', ref: { bucket: 'party', slot: 0 } });
    const overlay = root.querySelector('.comparison-overlay')!;
    expect(overlay.querySelector('.shiny-star')).toBeNull();
  });
});
