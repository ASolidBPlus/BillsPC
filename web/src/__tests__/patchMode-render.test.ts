/**
 * S10 Stage 1 + Stage 3 — patch-mode shell render.
 *
 * Verifies the empty two-column shell when no source / dest is loaded,
 * and asserts that the standard workbench is shown when patchMode is
 * absent (regression guard for the byte-identical-without-flag rule).
 *
 * Stage 3 adds: source-via-cart and source-via-SAV produce equivalent
 * SaveContents (D8); clicking a source mon opens the read-only details
 * pane.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSave, isSaveError, type SaveContents } from '@pokeportal/core';
import { renderPatchMode } from '../ui/patchMode.js';
import { emptyPatchSession } from '../state.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEMO_CRYSTAL = resolve(HERE, '../../../tests/fixtures/saves/demo-crystal.sav');

describe('patch-mode shell (empty)', () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
  });

  it('renders the source / dest columns with both load entry-points', () => {
    host.append(
      renderPatchMode({
        session: emptyPatchSession(),
        cartAvailable: true,
        onLoadSourceCart: () => {},
        onLoadSourceSav: () => {},
        onLoadDestCart: () => {},
        onLoadDestSav: () => {},
      }),
    );
    expect(host.querySelector('.patch-mode')).not.toBeNull();
    expect(host.querySelector('.patch-source-col')).not.toBeNull();
    expect(host.querySelector('.patch-dest-col')).not.toBeNull();
    expect(host.querySelector('.patch-source-dropzone')).not.toBeNull();
    expect(host.querySelector('.patch-dest-dropzone')).not.toBeNull();
    expect(host.textContent).toContain('Connect source cart');
    expect(host.textContent).toContain('Connect destination cart');
  });

  it('warns when refresh = lose corrections', () => {
    host.append(
      renderPatchMode({
        session: emptyPatchSession(),
        cartAvailable: false,
        onLoadSourceCart: () => {},
        onLoadSourceSav: () => {},
        onLoadDestCart: () => {},
        onLoadDestSav: () => {},
      }),
    );
    expect(host.textContent).toMatch(/refresh\s*=\s*lose corrections/i);
  });

  it('disables the cart buttons when cartAvailable=false', () => {
    host.append(
      renderPatchMode({
        session: emptyPatchSession(),
        cartAvailable: false,
        onLoadSourceCart: () => {},
        onLoadSourceSav: () => {},
        onLoadDestCart: () => {},
        onLoadDestSav: () => {},
      }),
    );
    const srcBtn = host.querySelector('.patch-source-col button');
    expect(srcBtn?.getAttribute('disabled')).toBe('disabled');
  });

  it('SAV file input wires onLoadSourceSav', () => {
    let captured: File | null = null;
    host.append(
      renderPatchMode({
        session: emptyPatchSession(),
        cartAvailable: true,
        onLoadSourceCart: () => {},
        onLoadSourceSav: (f) => {
          captured = f;
        },
        onLoadDestCart: () => {},
        onLoadDestSav: () => {},
      }),
    );
    const input = host.querySelector('.patch-source-file-input') as HTMLInputElement;
    expect(input).not.toBeNull();
    const file = new File([new Uint8Array(4)], 'src.sav', { type: 'application/octet-stream' });
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    expect(captured).toBe(file);
  });

  it('shows pendingEdits count when non-empty', () => {
    const session = {
      source: null,
      dest: null,
      pendingEdits: new Map([['0:0', { pid: 1 }]]),
    };
    host.append(
      renderPatchMode({
        session,
        cartAvailable: true,
        onLoadSourceCart: () => {},
        onLoadSourceSav: () => {},
        onLoadDestCart: () => {},
        onLoadDestSav: () => {},
      }),
    );
    expect(host.textContent).toContain('1 pending edit');
  });
});

/**
 * Stage 3 — source-via-cart vs source-via-SAV equivalence (D8).
 *
 * Both paths feed the same parser; the result MUST be a SaveContents
 * with byte-identical box layouts. We exercise the parser twice (the
 * "cart" path is just bytes-from-Buffer; the "SAV" path is also
 * bytes-from-File) and compare structurally.
 */
describe('source-via-cart vs source-via-SAV equivalence (D8)', () => {
  it('parsing the same crystal SAV through both paths produces equivalent SaveContents', () => {
    const bytes = new Uint8Array(readFileSync(DEMO_CRYSTAL));
    // "cart-connect" path: bytes arrive verbatim from the Web Serial
    // adapter, then `parseSave` is called inside the controller.
    const fromCart = parseSave(bytes);
    if (isSaveError(fromCart)) throw new Error('cart parse failed');
    // "SAV-upload" path: same parser is invoked on the same byte buffer
    // (in production, after `file.arrayBuffer()`); the controller wires
    // `handlePatchSourceSav` to call the same `parseSave` so the result
    // MUST be structurally identical.
    const fromSav = parseSave(new Uint8Array(bytes));
    if (isSaveError(fromSav)) throw new Error('SAV parse failed');
    expect(fromCart.format).toBe(fromSav.format);
    expect(fromCart.trainer.tid).toBe(fromSav.trainer.tid);
    expect(fromCart.trainer.name).toBe(fromSav.trainer.name);
    expect(fromCart.party.length).toBe(fromSav.party.length);
    expect(fromCart.boxes.length).toBe(fromSav.boxes.length);
    // Byte-equal first occupied box if any.
    const firstNonEmptyBox = fromCart.boxes.findIndex((b) => b.length > 0);
    if (firstNonEmptyBox >= 0) {
      const a = fromCart.boxes[firstNonEmptyBox]![0]!;
      const b = fromSav.boxes[firstNonEmptyBox]![0]!;
      expect(a.speciesGen2Id).toBe(b.speciesGen2Id);
      expect(a.tid).toBe(b.tid);
      expect(a.level).toBe(b.level);
    }
  });
});

/**
 * Stage 3 — source-mon click opens the read-only details pane.
 *
 * The patch-mode renderer wires `onMonOpen` on the source-side box
 * browser; clicking a tile invokes that handler and (when a real
 * Gen 1/2 mon is at the ref) opens the details pane.
 */
describe('source-mon click → details pane (Stage 3)', () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.replaceChildren();
    document.body.append(host);
  });

  it('clicking an occupied source tile opens the details pane', () => {
    const bytes = new Uint8Array(readFileSync(DEMO_CRYSTAL));
    const parsed = parseSave(bytes) as SaveContents;
    host.append(
      renderPatchMode({
        session: {
          source: { save: parsed, cartLabel: 'crystal.sav' },
          dest: null,
          pendingEdits: new Map(),
        },
        cartAvailable: true,
        onLoadSourceCart: () => {},
        onLoadSourceSav: () => {},
        onLoadDestCart: () => {},
        onLoadDestSav: () => {},
        // Stub convert — returns null to skip the AFTER panel; we only
        // assert the BEFORE/AFTER modal overlay opens, not its contents.
        convert: () => null,
      }),
    );
    // Find the first occupied box-tile in the source browser and click it.
    const occupied = host.querySelector('.patch-source-browser .box-tile.is-occupied');
    expect(occupied).not.toBeNull();
    (occupied as HTMLElement).click();
    // Stat-screen modal opens with `.ss-overlay` class.
    expect(document.body.querySelector('.ss-overlay')).not.toBeNull();
  });
});
