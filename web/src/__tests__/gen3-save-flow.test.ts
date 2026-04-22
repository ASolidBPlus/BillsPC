/**
 * S6a — End-to-end save-to-save flow (jsdom integration).
 *
 * Drop a Crystal source + a Gen 3 destination, click a mon, click STORE,
 * and assert the modified-save bytes contain the injected mon at the
 * chosen slot.
 *
 * Per orchestrator brief: "drop both source + destination, navigate to a
 * mon, click STORE, assert the download URL was generated and the
 * modified-save bytes contain the injected mon at the chosen slot."
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createController,
  handleFileSelected,
  handleDestFileSelected,
  suggestModifiedFilename,
  DEFAULT_DEPS,
} from '../ui.js';
import { parseGen3Save, isGen3SaveError } from '@pokeportal/core';

const HERE = dirname(fileURLToPath(import.meta.url));
const CRYSTAL = resolve(HERE, '../../../tests/fixtures/saves/demo-crystal.sav');
const RUBY = resolve(HERE, '../../../core/test-fixtures/gen3/ruby.sav');

function mkFile(bytes: Uint8Array, name: string): File {
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const f = new File([ab], name, { type: 'application/octet-stream' });
  if (typeof f.arrayBuffer !== 'function') {
    Object.defineProperty(f, 'arrayBuffer', { value: () => Promise.resolve(ab) });
  }
  return f;
}

describe('S6a save-to-save flow (jsdom integration)', () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.replaceChildren();
    root = document.createElement('div');
    root.id = 'app';
    document.body.appendChild(root);
  });

  it('shows the dest drop zone in loaded state when no dest is loaded', async () => {
    const controller = createController(root);
    const bytes = new Uint8Array(readFileSync(CRYSTAL));
    await handleFileSelected(
      mkFile(bytes, 'demo-crystal.sav'),
      (a) => controller.dispatch(a),
      DEFAULT_DEPS,
    );
    expect(root.querySelector('.dest-drop-zone')).not.toBeNull();
  });

  it('parses the destination .sav and renders the dest box browser', async () => {
    const controller = createController(root);
    await handleFileSelected(
      mkFile(new Uint8Array(readFileSync(CRYSTAL)), 'demo-crystal.sav'),
      (a) => controller.dispatch(a),
      DEFAULT_DEPS,
    );
    await handleDestFileSelected(
      mkFile(new Uint8Array(readFileSync(RUBY)), 'ruby.sav'),
      (a) => controller.dispatch(a),
      DEFAULT_DEPS,
    );
    expect(controller.state().kind).toBe('loaded');
    if (controller.state().kind !== 'loaded') return;
    const s = controller.state() as Extract<
      typeof controller.state extends () => infer T ? T : never,
      { kind: 'loaded' }
    >;
    expect(s.dest).toBeDefined();
    expect(s.dest!.fileName).toBe('ruby.sav');
    expect(root.querySelector('.dest-box-browser')).not.toBeNull();
  });

  it('rejects a too-short destination buffer and surfaces a parse error', async () => {
    const controller = createController(root);
    await handleFileSelected(
      mkFile(new Uint8Array(readFileSync(CRYSTAL)), 'demo-crystal.sav'),
      (a) => controller.dispatch(a),
      DEFAULT_DEPS,
    );
    await handleDestFileSelected(
      mkFile(new Uint8Array(100), 'too-short.sav'),
      (a) => controller.dispatch(a),
      DEFAULT_DEPS,
    );
    if (controller.state().kind !== 'loaded') throw new Error('expected loaded');
    const text = root.textContent ?? '';
    expect(text).toContain('too-short.sav');
    expect(text).toContain('TOO_SHORT');
  });

  it('STORE-in-destination is disabled when no dest is loaded; tooltip explains why', async () => {
    const controller = createController(root);
    await handleFileSelected(
      mkFile(new Uint8Array(readFileSync(CRYSTAL)), 'demo-crystal.sav'),
      (a) => controller.dispatch(a),
      DEFAULT_DEPS,
    );
    const tile = root.querySelector('.box-tile.is-occupied') as HTMLElement;
    tile.click();
    const disabledRow = root.querySelector('.gen2-menu-row.is-disabled');
    expect(disabledRow).not.toBeNull();
    expect(disabledRow!.getAttribute('title')).toContain('Load a destination');
    expect(disabledRow!.textContent).toContain('STORE in destination');
  });

  it('STORE click after loading dest writes a modified-save buffer to state.destDownload, and the bytes contain the injected mon at the chosen slot', async () => {
    const controller = createController(root);
    await handleFileSelected(
      mkFile(new Uint8Array(readFileSync(CRYSTAL)), 'demo-crystal.sav'),
      (a) => controller.dispatch(a),
      DEFAULT_DEPS,
    );
    await handleDestFileSelected(
      mkFile(new Uint8Array(readFileSync(RUBY)), 'ruby.sav'),
      (a) => controller.dispatch(a),
      DEFAULT_DEPS,
    );
    // Pick a Crystal mon to convert + store. The first .is-occupied tile
    // is the party-slot 0 mon (Typhlosion in demo-crystal); any party
    // mon will convert into a packed Gen 3 record we can inject.
    const tile = root.querySelector('.box-tile.is-occupied') as HTMLElement;
    tile.click();
    // Ruby's box 0 (BOX 1) is empty per fixture metadata, and the dest
    // cursor defaults to (0,0) which is box 0 slot 0.
    const storeRow = Array.from(root.querySelectorAll('.gen2-menu-row')).find((r) =>
      r.textContent?.includes('STORE in destination'),
    ) as HTMLElement;
    expect(storeRow).toBeDefined();
    expect(storeRow.classList.contains('is-disabled')).toBe(false);
    storeRow.click();
    const s = controller.state();
    if (s.kind !== 'loaded') throw new Error('expected loaded');
    expect(s.destDownload).toBeDefined();
    expect(s.destDownload!.bytes.length).toBe(131072);
    expect(s.destDownload!.suggestedFilename).toMatch(/^ruby\.modified-\d{14}\.sav$/);
    // Verify the modified bytes parse back AND contain a filled slot at
    // box 0 slot 0.
    const reparsed = parseGen3Save(s.destDownload!.bytes);
    if (isGen3SaveError(reparsed)) throw new Error(reparsed.message);
    const slot = reparsed.pc.boxes[0]?.[0];
    expect(slot?.kind).toBe('filled');
  });

  it('Download-modified button appears in the toolbar after a successful STORE and triggers a download', async () => {
    const captured: { name?: string; size?: number } = {};
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:fake');
    URL.revokeObjectURL = vi.fn();

    const origCreateEl = document.createElement.bind(document);
    document.createElement = ((tag: string) => {
      const e = origCreateEl(tag);
      if (tag === 'a') {
        const a = e as HTMLAnchorElement;
        const origClick = a.click.bind(a);
        a.click = () => {
          captured.name = a.download;
          origClick();
        };
      }
      return e;
    }) as typeof document.createElement;
    try {
      const controller = createController(root);
      await handleFileSelected(
        mkFile(new Uint8Array(readFileSync(CRYSTAL)), 'demo-crystal.sav'),
        (a) => controller.dispatch(a),
        DEFAULT_DEPS,
      );
      await handleDestFileSelected(
        mkFile(new Uint8Array(readFileSync(RUBY)), 'ruby.sav'),
        (a) => controller.dispatch(a),
        DEFAULT_DEPS,
      );
      const tile = root.querySelector('.box-tile.is-occupied') as HTMLElement;
      tile.click();
      const storeRow = Array.from(root.querySelectorAll('.gen2-menu-row')).find((r) =>
        r.textContent?.includes('STORE in destination'),
      ) as HTMLElement;
      storeRow.click();
      // The toolbar now has a "Download <name>" button.
      const dl = root.querySelector('.download-modified') as HTMLButtonElement;
      expect(dl).not.toBeNull();
      dl.click();
      expect(captured.name).toMatch(/^ruby\.modified-\d{14}\.sav$/);
    } finally {
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
      document.createElement = origCreateEl as typeof document.createElement;
    }
  });
});

describe('suggestModifiedFilename', () => {
  it('strips trailing .sav and appends timestamp', () => {
    const dt = new Date('2026-04-22T14:19:30');
    const out = suggestModifiedFilename('firered.sav', dt);
    expect(out).toBe('firered.modified-20260422141930.sav');
  });
  it('is case-insensitive on the trailing .sav', () => {
    const dt = new Date('2026-04-22T01:02:03');
    const out = suggestModifiedFilename('Pokemon Emerald.SAV', dt);
    expect(out).toBe('Pokemon Emerald.modified-20260422010203.sav');
  });
  it('preserves an extension-less name', () => {
    const dt = new Date('2026-04-22T00:00:00');
    const out = suggestModifiedFilename('raw-dump', dt);
    expect(out).toBe('raw-dump.modified-20260422000000.sav');
  });
});
