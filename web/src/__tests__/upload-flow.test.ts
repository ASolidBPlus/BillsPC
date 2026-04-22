/**
 * Integration test: simulate a real upload through the controller.
 *
 * Reads `tests/fixtures/saves/demo-crystal.sav` from disk, hands it to
 * the controller as a `File`, and asserts the new S5 flow: parsing →
 * loaded → box-browser visible → click on a populated tile opens the
 * comparison overlay → STORE downloads an 80-byte .pk3.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
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
    Object.defineProperty(f, 'arrayBuffer', {
      value: () => Promise.resolve(ab),
    });
  }
  return f;
}

describe('upload flow (jsdom integration)', () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.replaceChildren();
    root = document.createElement('div');
    root.id = 'app';
    document.body.appendChild(root);
  });

  it('renders the drop zone in idle state', () => {
    createController(root);
    expect(root.querySelector('.drop-zone')).not.toBeNull();
    const input = root.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.getAttribute('accept')).toBe('');
  });

  it('shows the parsing state before completing the parse (A13: paint-before-parse)', async () => {
    const controller = createController(root);
    const bytes = new Uint8Array(readFileSync(CRYSTAL));
    const file = mkFile(bytes, 'demo-crystal.sav');

    const promise = handleFileSelected(file, (a) => controller.dispatch(a), DEFAULT_DEPS);
    expect(controller.state().kind).toBe('parsing');
    await promise;
    expect(controller.state().kind).toBe('loaded');
  });

  it('renders the trainer dialog with name "Joel" after parsing demo-crystal.sav', async () => {
    const controller = createController(root);
    const bytes = new Uint8Array(readFileSync(CRYSTAL));
    await handleFileSelected(
      mkFile(bytes, 'demo-crystal.sav'),
      (a) => controller.dispatch(a),
      DEFAULT_DEPS,
    );

    expect(controller.state().kind).toBe('loaded');
    const text = root.textContent ?? '';
    expect(text).toContain('Joel');
    expect(text).toContain('CRYSTAL');
  });

  it('surfaces emulator_trailer_stripped + checksum_mismatch warnings in the UI', async () => {
    const controller = createController(root);
    const bytes = new Uint8Array(readFileSync(CRYSTAL));
    await handleFileSelected(
      mkFile(bytes, 'demo-crystal.sav'),
      (a) => controller.dispatch(a),
      DEFAULT_DEPS,
    );

    const warningsCard = root.querySelector('.warnings');
    expect(warningsCard).not.toBeNull();
    expect(warningsCard!.textContent).toContain('emulator_trailer_stripped(48)');
    expect(warningsCard!.textContent).toContain('checksum_mismatch');
  });

  it('renders the box browser and opens comparison overlay on tile click', async () => {
    const controller = createController(root);
    const bytes = new Uint8Array(readFileSync(CRYSTAL));
    await handleFileSelected(
      mkFile(bytes, 'demo-crystal.sav'),
      (a) => controller.dispatch(a),
      DEFAULT_DEPS,
    );

    expect(root.querySelector('.box-browser')).not.toBeNull();
    const occupied = root.querySelector('.box-tile.is-occupied') as HTMLElement;
    occupied.click();
    expect(root.querySelector('.comparison-overlay')).not.toBeNull();
    // S6a: the .pk3 download path remains via the "Download .pk3" row.
    const dlRow = Array.from(root.querySelectorAll('.gen2-menu-label')).find(
      (e) => e.textContent === 'Download .pk3',
    );
    expect(dlRow).toBeDefined();
  });

  it('clicking STORE on an open mon downloads an 80-byte .pk3', async () => {
    const captured: { name?: string; size?: number } = {};
    const origBlob = globalThis.Blob;
    class CapturingBlob extends origBlob {
      constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
        super(parts, options);
        for (const p of parts ?? []) {
          if (p instanceof ArrayBuffer) captured.size = (captured.size ?? 0) + p.byteLength;
          else if (ArrayBuffer.isView(p)) captured.size = (captured.size ?? 0) + p.byteLength;
        }
      }
    }
    (globalThis as { Blob: typeof Blob }).Blob = CapturingBlob;
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
      const bytes = new Uint8Array(readFileSync(CRYSTAL));
      await handleFileSelected(
        mkFile(bytes, 'demo-crystal.sav'),
        (a) => controller.dispatch(a),
        DEFAULT_DEPS,
      );

      // Open the first occupied tile (party slot 0 = BLAZOR / Feraligatr-class
      // Typhlosion in this fixture).
      const occupied = root.querySelector('.box-tile.is-occupied') as HTMLElement;
      occupied.click();

      captured.size = undefined;
      captured.name = undefined;

      // S6a: the .pk3 download path is now under "Download .pk3"; the
      // S5 single-mon download still works via this row.
      const dlRow = Array.from(root.querySelectorAll('.gen2-menu-row')).find((r) =>
        r.textContent?.includes('Download .pk3'),
      ) as HTMLElement;
      expect(dlRow).toBeDefined();
      dlRow.click();

      expect(captured.size).toBe(80);
      expect(captured.name).toMatch(/\.pk3$/);
    } finally {
      (globalThis as { Blob: typeof Blob }).Blob = origBlob;
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
      document.createElement = origCreateEl as typeof document.createElement;
    }
  });

  it('shows parse_error state for an unrecognized buffer', async () => {
    const controller = createController(root);
    const garbage = new Uint8Array(32768);
    await handleFileSelected(
      mkFile(garbage, 'bad.sav'),
      (a) => controller.dispatch(a),
      DEFAULT_DEPS,
    );
    expect(controller.state().kind).toBe('parse_error');
    const text = root.textContent ?? '';
    expect(text).toContain('UNRECOGNIZED_FORMAT');
  });
});
