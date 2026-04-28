/**
 * S7a — Mode toggle reducer + render tests.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { reducer, INITIAL_STATE } from '../state.js';
import { modeToggle } from '../ui/modeToggle.js';

describe('mode toggle (S7a)', () => {
  it('default mode is undefined → renderer treats as upload', () => {
    expect(INITIAL_STATE.mode).toBeUndefined();
  });

  it('mode_changed → cart updates state.mode', () => {
    const next = reducer(INITIAL_STATE, { type: 'mode_changed', mode: 'cart' });
    expect(next.mode).toBe('cart');
  });

  it('mode_changed → upload after cart is non-destructive (no state lost)', () => {
    const s1 = reducer(INITIAL_STATE, { type: 'mode_changed', mode: 'cart' });
    const s2 = reducer(s1, { type: 'cart_connect_failed', side: 'source', reason: 'X', message: 'y' });
    const s3 = reducer(s2, { type: 'mode_changed', mode: 'upload' });
    expect(s3.mode).toBe('upload');
    // Cart-error state is preserved across mode switches.
    expect(s3.cartReadError?.reason).toBe('X');
  });

  it('mode_changed with same mode is a no-op (returns same reference)', () => {
    const s1 = reducer(INITIAL_STATE, { type: 'mode_changed', mode: 'upload' });
    const s2 = reducer(s1, { type: 'mode_changed', mode: 'upload' });
    expect(s2).toBe(s1);
  });
});

describe('modeToggle component', () => {
  let host: HTMLElement;
  beforeEach(() => {
    document.body.replaceChildren();
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  it('renders two buttons + active class on the current mode', () => {
    let captured: string | undefined;
    const el = modeToggle({
      mode: 'cart',
      cartAvailable: true,
      onModeChange: (next) => {
        captured = next;
      },
    });
    host.append(el);
    const buttons = host.querySelectorAll('button');
    expect(buttons.length).toBe(2);
    expect(buttons[0]!.classList.contains('is-active')).toBe(false);
    expect(buttons[1]!.classList.contains('is-active')).toBe(true);
    (buttons[0]! as HTMLButtonElement).click();
    expect(captured).toBe('upload');
  });

  it('Cart Mode button is disabled when cartAvailable === false', () => {
    let disabledClicked = 0;
    let modeClicked = 0;
    const el = modeToggle({
      mode: 'upload',
      cartAvailable: false,
      onModeChange: () => {
        modeClicked++;
      },
      onDisabledClick: () => {
        disabledClicked++;
      },
    });
    host.append(el);
    const cartBtn = host.querySelectorAll('button')[1] as HTMLButtonElement;
    expect(cartBtn.getAttribute('aria-disabled')).toBe('true');
    expect(cartBtn.classList.contains('is-disabled')).toBe(true);
    expect(cartBtn.getAttribute('title')).toContain('Chromium');
    cartBtn.click();
    expect(disabledClicked).toBe(1);
    expect(modeClicked).toBe(0);
  });
});
