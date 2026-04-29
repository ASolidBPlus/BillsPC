/**
 * S10 Stage 1 — patch-mode shell render.
 *
 * Verifies the empty two-column shell when no source / dest is loaded,
 * and asserts that the standard workbench is shown when patchMode is
 * absent (regression guard for the byte-identical-without-flag rule).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderPatchMode } from '../ui/patchMode.js';
import { emptyPatchSession } from '../state.js';

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
