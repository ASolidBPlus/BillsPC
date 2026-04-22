/**
 * Vertical menu inside a Gen 2 dialog frame, with the iconic blinking
 * `▶` cursor on the selected row.
 *
 * The cursor occupies a fixed 8-px column so rows do not jump as the
 * cursor moves (PLAN §3.3).
 */
import { dialog } from './dialog.js';
import { el } from './dom.js';

export interface MenuItem {
  readonly label: string;
  readonly onSelect: () => void;
  readonly disabled?: boolean;
}

export interface MenuProps {
  readonly items: readonly MenuItem[];
  readonly selectedIndex: number;
  readonly onCursor?: (delta: -1 | 1) => void;
  readonly onCancel?: () => void;
}

export function menu(props: MenuProps): HTMLElement {
  const wrap = dialog({ class: 'gen2-menu' });
  for (let i = 0; i < props.items.length; i++) {
    const item = props.items[i]!;
    const row = el('div', { class: 'gen2-menu-row' + (item.disabled ? ' is-disabled' : '') });
    const cursor = el('span', { class: 'cursor-arrow' });
    if (i === props.selectedIndex) cursor.textContent = '▶';
    row.append(cursor, el('span', { class: 'gen2-menu-label' }, item.label));
    if (!item.disabled) {
      row.addEventListener('click', () => item.onSelect());
    }
    wrap.append(row);
  }
  return wrap;
}
