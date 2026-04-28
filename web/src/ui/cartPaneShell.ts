/**
 * Left-pane wrapper that enforces the "cart on LEFT, staging on RIGHT"
 * layout invariant from PLAN §10.1 (matches the user's earlier explicit
 * binding, recorded in `project_pokeportal_s7_cart_mode.md`).
 *
 * Trivial wrapper — exists so the controller can keep the layout
 * invariant in one place without each pane renderer worrying about it.
 */

import { el } from './dom.js';

export function cartPaneShell(side: 'left' | 'right', children: readonly HTMLElement[]): HTMLElement {
  const wrap = el('div', { class: `cart-pane-shell cart-pane-${side}` });
  for (const c of children) wrap.append(c);
  return wrap;
}
