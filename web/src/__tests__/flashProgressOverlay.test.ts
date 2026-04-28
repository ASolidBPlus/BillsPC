/**
 * S7b — `flashProgressOverlay` tests. Asserts the DO NOT UNPLUG banner
 * + per-phase copy + progress-bar bytes.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { flashProgressOverlay } from '../ui/flashProgressOverlay.js';

describe('flashProgressOverlay', () => {
  let host: HTMLElement;
  beforeEach(() => {
    document.body.replaceChildren();
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  it('renders the DO NOT UNPLUG banner during cart_flash_progressing', () => {
    const overlay = flashProgressOverlay({
      state: { kind: 'cart_flash_progressing', target: 'source', phase: 'flashing' },
    });
    host.append(overlay);
    expect(host.textContent).toMatch(/DO NOT UNPLUG/);
  });

  it('shows per-phase copy', () => {
    for (const [phase, expected] of [
      ['connecting', /Connecting to cart/],
      ['detecting', /Detecting firmware/],
      ['backup', /Saving backup/],
      ['flashing', /Writing to cart/],
      ['verifying', /Verifying/],
    ] as const) {
      document.body.replaceChildren();
      const h = document.createElement('div');
      document.body.appendChild(h);
      const overlay = flashProgressOverlay({
        state: { kind: 'cart_flash_progressing', target: 'source', phase },
      });
      h.append(overlay);
      expect(h.textContent).toMatch(expected);
    }
  });

  it('renders progress bar with bytesWritten/bytesTotal text', () => {
    const overlay = flashProgressOverlay({
      state: {
        kind: 'cart_flash_progressing',
        target: 'source',
        phase: 'flashing',
        progress: { bytesWritten: 1024, bytesTotal: 32768 },
      },
    });
    host.append(overlay);
    expect(host.textContent).toMatch(/1,024.*32,768/);
    const fill = host.querySelector('.flash-progress-bar-fill') as HTMLElement;
    expect(fill).not.toBeNull();
    expect(fill.style.width).toMatch(/^[\d.]+%$/);
  });

  it('renders the recovery filename during cart_recovery_progressing', () => {
    const overlay = flashProgressOverlay({
      state: {
        kind: 'cart_recovery_progressing',
        backupFilename: 'POKEMON-RED-12345.backup-pre-x.sav',
      },
    });
    host.append(overlay);
    expect(host.textContent).toMatch(/POKEMON-RED-12345/);
  });
});
