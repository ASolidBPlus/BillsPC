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
import { parseGen3Save, isGen3SaveError, parseSave, isSaveError } from '@pokeportal/core';
import { unzipSync } from 'fflate';

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

  it('STORE click after loading dest produces a zip containing both modified saves (S6b)', async () => {
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
    // S6b: bundle is now a zip with both modified saves.
    expect(s.destDownload!.suggestedFilename).toMatch(
      /^demo-crystal-to-ruby\.transfer-\d{14}\.zip$/,
    );
    const round = unzipSync(s.destDownload!.bytes);
    const names = Object.keys(round).sort();
    expect(names).toHaveLength(2);
    expect(names[0]).toMatch(/^demo-crystal\.modified-\d{14}\.sav$/);
    expect(names[1]).toMatch(/^ruby\.modified-\d{14}\.sav$/);
    // Destination .sav inside the zip injects the mon.
    const destBytes = round[names[1]!]!;
    expect(destBytes.length).toBe(131072);
    const reparsed = parseGen3Save(destBytes);
    if (isGen3SaveError(reparsed)) throw new Error(reparsed.message);
    const slot = reparsed.pc.boxes[0]?.[0];
    expect(slot?.kind).toBe('filled');
  });

  it('S6b: source .sav inside the zip has the transferred mon DELETED from its source slot', async () => {
    const controller = createController(root);
    await handleFileSelected(
      mkFile(new Uint8Array(readFileSync(CRYSTAL)), 'demo-crystal.sav'),
      (a) => controller.dispatch(a),
      DEFAULT_DEPS,
    );
    const beforeSave = parseSave(new Uint8Array(readFileSync(CRYSTAL)));
    if (isSaveError(beforeSave)) throw new Error(beforeSave.message);
    // S8 — the box browser no longer surfaces party, so the first
    // occupied tile is the first occupied stored-box mon (box 0).
    const box0LenBefore = beforeSave.boxes[0]!.length;
    const box0Slot0Species = beforeSave.boxes[0]![0]!.speciesGen2Id;

    await handleDestFileSelected(
      mkFile(new Uint8Array(readFileSync(RUBY)), 'ruby.sav'),
      (a) => controller.dispatch(a),
      DEFAULT_DEPS,
    );
    // Click the first occupied tile (storage box 0 slot 0 of demo-crystal).
    const tile = root.querySelector('.box-tile.is-occupied') as HTMLElement;
    tile.click();
    const storeRow = Array.from(root.querySelectorAll('.gen2-menu-row')).find((r) =>
      r.textContent?.includes('STORE in destination'),
    ) as HTMLElement;
    storeRow.click();
    const s = controller.state();
    if (s.kind !== 'loaded') throw new Error('expected loaded');
    const round = unzipSync(s.destDownload!.bytes);
    const sourceEntry = Object.entries(round).find(([n]) => n.startsWith('demo-crystal'));
    expect(sourceEntry).toBeDefined();
    const sourceBytes = sourceEntry![1]!;
    const reSrc = parseSave(sourceBytes);
    if (isSaveError(reSrc)) throw new Error(reSrc.message);
    expect(reSrc.boxes[0]!.length).toBe(box0LenBefore - 1);
    // The slot-0 mon is gone; whatever was at slot 1 has shifted down.
    expect(reSrc.boxes[0]![0]!.speciesGen2Id).not.toBe(box0Slot0Species);
    // In-memory source state also reflects the delete (chained STORE support).
    expect(s.save.boxes[0]!.length).toBe(box0LenBefore - 1);
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
      // The toolbar now has a "Download <name>" button — S6b uses a zip.
      const dl = root.querySelector('.download-modified') as HTMLButtonElement;
      expect(dl).not.toBeNull();
      dl.click();
      expect(captured.name).toMatch(/^demo-crystal-to-ruby\.transfer-\d{14}\.zip$/);
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
