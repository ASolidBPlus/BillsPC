/**
 * S7b — `confirmFlashDialog` tests. Per AMEND-S7b-8 the dialog requires
 * BOTH a checkbox tick AND an exact `===` match of the typed string
 * `PROCEED <ACTION> <CART-LABEL>`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  confirmFlashDialog,
  expectedConfirmString,
} from '../ui/confirmFlashDialog.js';

describe('expectedConfirmString', () => {
  it('uppercases + dasherises the cart label (legacy DELETE FROM / WRITE TO)', () => {
    expect(expectedConfirmString('DELETE FROM', 'POKEMON CRYSTAL (32 KB)')).toBe(
      'PROCEED DELETE FROM POKEMON-CRYSTAL-32-KB',
    );
    expect(expectedConfirmString('WRITE TO', 'POKEMON RUBY (128 KB)')).toBe(
      'PROCEED WRITE TO POKEMON-RUBY-128-KB',
    );
  });

  // S8v2.3 / AMEND-S8v2.3-2 / orchestrator A3: 'WITH COMMIT' is the new
  // single-phrase variant. The cart label is intentionally NOT in the
  // typed string (button is per-side; visual verification of the cart
  // happens via the dialog body).
  it('WITH COMMIT returns the literal "PROCEED WITH COMMIT" — no cart label', () => {
    expect(expectedConfirmString('WITH COMMIT', 'POKEMON CRYSTAL (32 KB)')).toBe(
      'PROCEED WITH COMMIT',
    );
    expect(expectedConfirmString('WITH COMMIT', 'POKEMON RUBY (128 KB)')).toBe(
      'PROCEED WITH COMMIT',
    );
  });
});

describe('confirmFlashDialog gate', () => {
  let host: HTMLElement;
  beforeEach(() => {
    document.body.replaceChildren();
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  function mount(opts: {
    onConfirm?: () => void;
    onCancel?: () => void;
  } = {}): {
    commitBtn: HTMLButtonElement;
    cancelBtn: HTMLButtonElement;
    checkbox: HTMLInputElement;
    input: HTMLInputElement;
  } {
    const dialog = confirmFlashDialog({
      action: 'DELETE FROM',
      cartLabel: 'POKEMON CRYSTAL (32 KB)',
      cartTid: 12345,
      summaryLines: ['Box 5 slot 12: Feraligatr (lvl 100)'],
      performSteps: ['Backup current cart bytes', 'Flash modified bytes', 'Verify byte-by-byte'],
      onConfirm: opts.onConfirm ?? (() => undefined),
      onCancel: opts.onCancel ?? (() => undefined),
    });
    host.append(dialog);
    return {
      commitBtn: host.querySelector('.commit-button') as HTMLButtonElement,
      cancelBtn: host.querySelector('.confirm-buttons .secondary') as HTMLButtonElement,
      checkbox: host.querySelector('.confirm-checkbox-input') as HTMLInputElement,
      input: host.querySelector('.confirm-typed-input-field') as HTMLInputElement,
    };
  }

  it('initial state: Commit is disabled', () => {
    const { commitBtn } = mount();
    expect(commitBtn.disabled).toBe(true);
  });

  it('checkbox alone leaves Commit disabled', () => {
    const { commitBtn, checkbox } = mount();
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(commitBtn.disabled).toBe(true);
  });

  it('typed string alone leaves Commit disabled', () => {
    const { commitBtn, input } = mount();
    input.value = 'PROCEED DELETE FROM POKEMON-CRYSTAL-32-KB';
    input.dispatchEvent(new Event('input'));
    expect(commitBtn.disabled).toBe(true);
  });

  it('lowercase typed string leaves Commit disabled (strict ===)', () => {
    const { commitBtn, checkbox, input } = mount();
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    input.value = 'proceed delete from pokemon-crystal-32-kb';
    input.dispatchEvent(new Event('input'));
    expect(commitBtn.disabled).toBe(true);
  });

  it('typed string with leading/trailing whitespace leaves Commit disabled', () => {
    const { commitBtn, checkbox, input } = mount();
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    input.value = ' PROCEED DELETE FROM POKEMON-CRYSTAL-32-KB ';
    input.dispatchEvent(new Event('input'));
    expect(commitBtn.disabled).toBe(true);
  });

  it('wrong cart label (just PROCEED, no suffix) leaves Commit disabled', () => {
    const { commitBtn, checkbox, input } = mount();
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    input.value = 'PROCEED';
    input.dispatchEvent(new Event('input'));
    expect(commitBtn.disabled).toBe(true);
  });

  it('wrong cart name (RUBY instead of CRYSTAL) leaves Commit disabled', () => {
    const { commitBtn, checkbox, input } = mount();
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    input.value = 'PROCEED DELETE FROM POKEMON-RUBY-32-KB';
    input.dispatchEvent(new Event('input'));
    expect(commitBtn.disabled).toBe(true);
  });

  it('exact typed string + checkbox enables Commit', () => {
    const { commitBtn, checkbox, input } = mount();
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    input.value = 'PROCEED DELETE FROM POKEMON-CRYSTAL-32-KB';
    input.dispatchEvent(new Event('input'));
    expect(commitBtn.disabled).toBe(false);
  });

  it('Cancel fires onCancel', () => {
    let cancelled = false;
    const { cancelBtn } = mount({ onCancel: () => (cancelled = true) });
    cancelBtn.click();
    expect(cancelled).toBe(true);
  });

  it('Commit fires onConfirm (only when enabled)', () => {
    let confirmed = false;
    const { commitBtn, checkbox, input } = mount({ onConfirm: () => (confirmed = true) });
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    input.value = 'PROCEED DELETE FROM POKEMON-CRYSTAL-32-KB';
    input.dispatchEvent(new Event('input'));
    commitBtn.click();
    expect(confirmed).toBe(true);
  });
});

// S8v2.3 / AMEND-S8v2.3-2 — the dialog must accept the new 'WITH COMMIT'
// action variant and require the literal `PROCEED WITH COMMIT` string
// (NO cart label suffix, per orchestrator A3).
describe("confirmFlashDialog gate — 'WITH COMMIT' variant (S8v2.3)", () => {
  let host: HTMLElement;
  beforeEach(() => {
    document.body.replaceChildren();
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  function mountWithCommit(opts: {
    onConfirm?: () => void;
    onCancel?: () => void;
  } = {}): {
    commitBtn: HTMLButtonElement;
    cancelBtn: HTMLButtonElement;
    checkbox: HTMLInputElement;
    input: HTMLInputElement;
    body: HTMLElement;
  } {
    const dialog = confirmFlashDialog({
      action: 'WITH COMMIT',
      cartLabel: 'POKEMON CRYSTAL (32 KB)',
      cartTid: 12345,
      summaryLines: ['Commit 3 staged mons to source cart (DELETE).'],
      performSteps: ['Backup', 'Flash', 'Verify'],
      onConfirm: opts.onConfirm ?? (() => undefined),
      onCancel: opts.onCancel ?? (() => undefined),
    });
    host.append(dialog);
    return {
      commitBtn: host.querySelector('.commit-button') as HTMLButtonElement,
      cancelBtn: host.querySelector('.confirm-buttons .secondary') as HTMLButtonElement,
      checkbox: host.querySelector('.confirm-checkbox-input') as HTMLInputElement,
      input: host.querySelector('.confirm-typed-input-field') as HTMLInputElement,
      body: dialog,
    };
  }

  it("typed 'PROCEED WITH COMMIT' + checkbox enables Commit (no cart-label suffix)", () => {
    const { commitBtn, checkbox, input } = mountWithCommit();
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    input.value = 'PROCEED WITH COMMIT';
    input.dispatchEvent(new Event('input'));
    expect(commitBtn.disabled).toBe(false);
  });

  it('typed string with the cart-label suffix is REJECTED (strict ===)', () => {
    const { commitBtn, checkbox, input } = mountWithCommit();
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    // Mirrors what the user might guess — the legacy DELETE FROM dialog
    // appended the cart label. The new variant must NOT accept it.
    input.value = 'PROCEED WITH COMMIT POKEMON-CRYSTAL-32-KB';
    input.dispatchEvent(new Event('input'));
    expect(commitBtn.disabled).toBe(true);
  });

  it('cart label still appears in the dialog body for visual verification (per A3)', () => {
    const { body } = mountWithCommit();
    // Per orchestrator A3 — the body MUST surface the cart label so the
    // user sees what they're committing to even though the typed phrase
    // doesn't include it. The existing chrome puts it in `.confirm-cart`.
    const cartLine = body.querySelector('.confirm-cart');
    expect(cartLine?.textContent ?? '').toContain('POKEMON CRYSTAL (32 KB)');
  });

  it('legacy DELETE FROM path still works (regression — no widening drift)', () => {
    // Mount the legacy variant inline (separate dialog) to assert the old
    // path is byte-identical to before AMEND-S8v2.3-2 widened the union.
    document.body.replaceChildren();
    const root = document.createElement('div');
    document.body.appendChild(root);
    const dlg = confirmFlashDialog({
      action: 'DELETE FROM',
      cartLabel: 'POKEMON CRYSTAL (32 KB)',
      cartTid: 12345,
      summaryLines: [],
      performSteps: [],
      onConfirm: () => undefined,
      onCancel: () => undefined,
    });
    root.append(dlg);
    const commitBtn = root.querySelector('.commit-button') as HTMLButtonElement;
    const checkbox = root.querySelector('.confirm-checkbox-input') as HTMLInputElement;
    const input = root.querySelector('.confirm-typed-input-field') as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    input.value = 'PROCEED DELETE FROM POKEMON-CRYSTAL-32-KB';
    input.dispatchEvent(new Event('input'));
    expect(commitBtn.disabled).toBe(false);
  });
});
