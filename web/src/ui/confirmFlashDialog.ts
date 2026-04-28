/**
 * Multi-step typed-PROCEED confirmation modal. Per AMEND-S7b-8 the
 * required input is `PROCEED <ACTION> <CART-LABEL-UPPERCASE-DASHED>`,
 * exact match (no leading/trailing whitespace), strict `===` comparison.
 *
 * Two visual gates required to enable the Commit button:
 *   1. "I have read..." checkbox.
 *   2. Typed input matches the expected suffix exactly.
 *
 * Per AMEND-S7b-8 #4: tested against:
 *   - empty string → disabled
 *   - lowercase variant → disabled
 *   - whitespace prefix/suffix → disabled
 *   - partial / wrong cart label → disabled
 *
 * The dialog returns:
 *   - 'commit' if the user typed the expected string and ticked the box
 *     and clicked "Commit"
 *   - 'cancel' otherwise (user dismissed via Cancel)
 */

import { dialog } from './dialog.js';
import { el } from './dom.js';

export interface ConfirmFlashDialogProps {
  /**
   * One of 'DELETE FROM' (source commit, v1 path), 'WRITE TO' (destination
   * commit, v1 path), or 'WITH COMMIT' (v2.3 path — single phrase per
   * orchestrator A3 / AMEND-S8v2.3-2). For 'DELETE FROM' / 'WRITE TO' the
   * required string is `PROCEED <ACTION> <CART-LABEL>`. For 'WITH COMMIT'
   * the required string is the literal `PROCEED WITH COMMIT` — NO cart
   * label (the cart label still appears in the dialog body for visual
   * verification per A3, but it isn't typed).
   */
  readonly action: 'DELETE FROM' | 'WRITE TO' | 'WITH COMMIT';
  /** Cart label as shown in the UI, e.g. "POKEMON CRYSTAL (32 KB)". */
  readonly cartLabel: string;
  /** Trainer ID for sanity-line display. */
  readonly cartTid: number;
  /** "Will delete..." or "Will inject..." line(s). */
  readonly summaryLines: readonly string[];
  /** Per-step copy: ordered list of "Will perform" steps. */
  readonly performSteps: readonly string[];
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/**
 * Compute the required typed string for a given action + cart label.
 *
 * Per AMEND-S8v2.3-2 / orchestrator A3: when `action === 'WITH COMMIT'`
 * the cart label is intentionally NOT included in the typed phrase — the
 * Commit button in the trading-pipe is per-side already, so the action
 * suffices. The cart label is shown in the dialog body so the user can
 * still visually verify the connected cart before typing.
 */
export function expectedConfirmString(action: string, cartLabel: string): string {
  if (action === 'WITH COMMIT') return 'PROCEED WITH COMMIT';
  // Uppercase the cart label, replace any non-alphanumeric run with a single dash,
  // strip leading/trailing dashes.
  const safe = cartLabel
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `PROCEED ${action} ${safe}`;
}

export function confirmFlashDialog(props: ConfirmFlashDialogProps): HTMLElement {
  const expected = expectedConfirmString(props.action, props.cartLabel);
  const wrap = dialog({ class: 'gen2-dialog confirm-flash-dialog' });

  const title =
    props.action === 'WITH COMMIT'
      ? `Commit: ${props.cartLabel}`
      : `Commit to ${props.action.toLowerCase()}: ${props.cartLabel}`;
  wrap.append(el('div', { class: 'gen2-line confirm-title' }, title));
  wrap.append(
    el(
      'div',
      { class: 'gen2-line confirm-cart' },
      `Cart: ${props.cartLabel}, TID ${props.cartTid}`,
    ),
  );

  if (props.summaryLines.length > 0) {
    const sumGroup = el('div', { class: 'confirm-summary' });
    sumGroup.append(el('div', { class: 'gen2-line' }, 'Will affect:'));
    for (const line of props.summaryLines) {
      sumGroup.append(el('div', { class: 'gen2-line indent' }, `- ${line}`));
    }
    wrap.append(sumGroup);
  }

  const stepsGroup = el('div', { class: 'confirm-steps' });
  stepsGroup.append(el('div', { class: 'gen2-line' }, 'Will perform:'));
  let i = 1;
  for (const step of props.performSteps) {
    stepsGroup.append(el('div', { class: 'gen2-line indent' }, `${i}. ${step}`));
    i++;
  }
  wrap.append(stepsGroup);

  const checkboxLabel = el('label', { class: 'confirm-checkbox' });
  const checkbox = el('input', {
    type: 'checkbox',
    class: 'confirm-checkbox-input',
  }) as HTMLInputElement;
  checkboxLabel.append(checkbox, ' I have read the above and understand the risk.');
  wrap.append(checkboxLabel);

  const inputGroup = el('div', { class: 'confirm-typed-input' });
  inputGroup.append(el('label', {}, `Type "${expected}" to confirm:`));
  const input = el('input', {
    type: 'text',
    class: 'confirm-typed-input-field',
    autocomplete: 'off',
    spellcheck: 'false',
  }) as HTMLInputElement;
  inputGroup.append(input);
  wrap.append(inputGroup);

  const buttonRow = el('div', { class: 'confirm-buttons' });
  const cancelBtn = el(
    'button',
    { type: 'button', class: 'secondary' },
    'Cancel',
  ) as HTMLButtonElement;
  cancelBtn.addEventListener('click', () => props.onCancel());
  const commitBtn = el(
    'button',
    { type: 'button', class: 'primary commit-button', disabled: 'disabled' },
    'Commit',
  ) as HTMLButtonElement;
  commitBtn.addEventListener('click', () => {
    if (!commitBtn.disabled) props.onConfirm();
  });
  buttonRow.append(cancelBtn, commitBtn);
  wrap.append(buttonRow);

  const recheck = (): void => {
    // Strict === per AMEND-S7b-8: no trim, no case-insensitive.
    const match = input.value === expected;
    const checked = checkbox.checked;
    if (match && checked) {
      commitBtn.removeAttribute('disabled');
    } else {
      commitBtn.setAttribute('disabled', 'disabled');
    }
  };
  checkbox.addEventListener('change', recheck);
  input.addEventListener('input', recheck);

  const backdrop = el('div', { class: 'flash-modal-backdrop' });
  backdrop.append(wrap);
  return backdrop;
}
