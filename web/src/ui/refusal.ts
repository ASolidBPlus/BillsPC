/**
 * Gen 1-style red "It cannot be moved!" refusal dialog (PLAN_EVAL S5 A10).
 *
 * Layout (per A10):
 *   ┌────────────────────────────────┐  ← red outer border
 *   │  <NICK> CANNOT BE MOVED!        │  centered, --gbc-accent-red
 *   │                                  │
 *   │  ★ <reason in normal text>      │  --gbc-text
 *   │  ▼ press B to cancel            │  --gbc-dark-gray, ▼ blinks
 *   └────────────────────────────────┘
 *
 * The red outer border is applied via the `.gen2-dialog--refusal`
 * modifier — re-uses the standard `.gen2-dialog` chrome.
 */
import { dialog } from './dialog.js';
import { el } from './dom.js';

export function refusalDialog(nickname: string, reason: string, message: string): HTMLElement {
  const wrap = dialog({ class: 'gen2-dialog--refusal refusal-dialog' });
  wrap.append(
    el('div', { class: 'refusal-title' }, `${nickname.toUpperCase()} CANNOT BE MOVED!`),
    el('div', { class: 'refusal-spacer' }),
    el('div', { class: 'refusal-reason' }, `★ ${reason}: ${message}`),
    el(
      'div',
      { class: 'refusal-prompt' },
      el('span', { class: 'cursor-arrow refusal-arrow' }, '▼'),
      el('span', {}, ' press B to cancel'),
    ),
  );
  return wrap;
}
