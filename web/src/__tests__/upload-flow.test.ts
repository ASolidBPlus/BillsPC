/**
 * Integration test: simulate a real upload through the controller.
 *
 * Reads `tests/fixtures/saves/demo-crystal.sav` from disk, hands it to
 * the controller as a `File`, and asserts:
 *   - parsing state renders before parse finishes
 *   - loaded state renders Feraligatr by name (not species id)
 *   - clicking Convert downloads an 80-byte .pk3 (intercepted via a
 *     stubbed URL.createObjectURL)
 *
 * Per PLAN_EVAL A13 — the controller must yield before parsing so the
 * "Parsing…" text actually appears. This test asserts that the parsing
 * card is in the DOM after the file is selected and BEFORE the parsed
 * state arrives.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createController, handleFileSelected, DEFAULT_DEPS } from '../ui.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CRYSTAL = resolve(HERE, '../../../tests/fixtures/saves/demo-crystal.sav');

function mkFile(bytes: Uint8Array, name: string): File {
  // jsdom's File omits .arrayBuffer() — patch it on so the controller
  // can read the bytes the same way real browsers do.
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
    // Per PLAN_EVAL A12: accept attribute is empty (any extension OK).
    expect(input.getAttribute('accept')).toBe('');
  });

  it('shows the parsing state before completing the parse (A13: paint-before-parse)', async () => {
    const controller = createController(root);
    const bytes = new Uint8Array(readFileSync(CRYSTAL));
    const file = mkFile(bytes, 'demo-crystal.sav');

    // Kick off but observe before awaiting.
    const promise = handleFileSelected(file, (a) => controller.dispatch(a), DEFAULT_DEPS);
    // The synchronous portion of handleFileSelected dispatches file_selected
    // and then `await`s a frame yield. By the time we get here, we are
    // suspended inside the rAF wait — the parsing state should be live.
    expect(controller.state().kind).toBe('parsing');
    await promise;
    expect(controller.state().kind).toBe('loaded');
  });

  it('renders the trainer card with name "Joel" after parsing demo-crystal.sav', async () => {
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
    expect(text).toContain('Feraligatr');
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

  it('downloads an 80-byte .pk3 when Convert is clicked on Feraligatr', async () => {
    // Stub the Blob constructor to capture the bytes we're about to ship
    // through URL.createObjectURL — jsdom's Blob has no .arrayBuffer().
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
      const el = origCreateEl(tag);
      if (tag === 'a') {
        const a = el as HTMLAnchorElement;
        const origClick = a.click.bind(a);
        a.click = () => {
          captured.name = a.download;
          origClick();
        };
      }
      return el;
    }) as typeof document.createElement;

    try {
      const controller = createController(root);
      const bytes = new Uint8Array(readFileSync(CRYSTAL));
      await handleFileSelected(
        mkFile(bytes, 'demo-crystal.sav'),
        (a) => controller.dispatch(a),
        DEFAULT_DEPS,
      );

      // Reset captured state after parsing-related Blob constructions.
      captured.size = undefined;
      captured.name = undefined;

      const buttons = Array.from(root.querySelectorAll('button')) as HTMLButtonElement[];
      const dlButtons = buttons.filter((b) => b.textContent?.includes('Download .pk3'));
      expect(dlButtons.length).toBeGreaterThan(0);
      dlButtons[0]!.click();

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
    const garbage = new Uint8Array(32768); // all zeros — no format detected
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
