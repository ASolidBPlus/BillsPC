/**
 * S7a — cartProgress overlay component.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { cartProgress } from '../ui/cartProgress.js';

describe('cartProgress', () => {
  let host: HTMLElement;
  beforeEach(() => {
    document.body.replaceChildren();
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  it('renders the bytes-read / bytes-total meta line and the percentage', () => {
    const el = cartProgress({ label: 'POKEMON RED', bytesRead: 8192, bytesTotal: 32768 });
    host.append(el);
    const meta = host.querySelector('.cart-progress__meta');
    expect(meta!.textContent).toContain('25%');
    expect(meta!.textContent).toContain('8,192');
    expect(meta!.textContent).toContain('32,768');
  });

  it('shows the phase label per opts.phase', () => {
    const el = cartProgress({ label: '', bytesRead: 0, bytesTotal: 0, phase: 'detecting' });
    host.append(el);
    expect(host.querySelector('.cart-progress__phase')!.textContent).toContain('Detecting');
  });

  it('cancel button calls onCancel', () => {
    let cancelled = 0;
    const el = cartProgress({
      label: '',
      bytesRead: 100,
      bytesTotal: 200,
      onCancel: () => {
        cancelled++;
      },
    });
    host.append(el);
    (host.querySelector('button')! as HTMLButtonElement).click();
    expect(cancelled).toBe(1);
  });
});
