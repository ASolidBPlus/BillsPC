/**
 * Generic Gen 2-style dialog box helper. The visual chrome is in
 * `style.css` under `.gen2-dialog` (4 px outer black border + triple
 * inset shadow per PLAN §3.2).
 *
 * Per PLAN_EVAL A10, the refusal modifier swaps the outer border to red
 * via `.gen2-dialog--refusal`.
 */
import { el } from './dom.js';

export function dialog(opts: { class?: string } = {}): HTMLElement {
  const cls = ['gen2-dialog', opts.class].filter(Boolean).join(' ');
  return el('div', { class: cls });
}

export function textDialog(lines: readonly string[], opts: { class?: string } = {}): HTMLElement {
  const d = dialog(opts);
  for (const line of lines) {
    d.append(el('div', { class: 'gen2-line' }, line));
  }
  return d;
}
