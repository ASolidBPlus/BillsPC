/**
 * S10 Stage 3 — read-only source-mon details pane.
 *
 * Rendered when the user clicks a source mon in patch mode. Shows
 * TID/SID/PID/IVs/OT/nickname for visual reference; the user types
 * these values into the destination edit modal manually (per D2).
 *
 * No auto-match, no auto-apply — strictly a comparison surface.
 */

import type { Gen12Pokemon } from '@pokeportal/core';
import { decodeGen12, hpDv } from '@pokeportal/core/internal';
import { el } from './dom.js';

export function openSourceDetailsPane(mon: Gen12Pokemon): void {
  for (const node of Array.from(document.body.querySelectorAll('.source-details-overlay'))) {
    node.remove();
  }
  const overlay = el('div', { class: 'source-details-overlay' });
  const inner = el('div', { class: 'source-details-inner card' });

  const nick = decodeGen12(mon.nicknameBytes).trim() || `species-${mon.speciesGen2Id}`;
  const ot = decodeGen12(mon.otNameBytes).trim() || '?';

  inner.append(
    el('div', { class: 'source-details-title' }, 'SOURCE MON — read-only reference'),
    el(
      'div',
      { class: 'source-details-subtitle' },
      `${nick}  ·  ndex ${mon.speciesGen2Id}  ·  Lv${mon.level}`,
    ),
  );

  // Identity strip (TID — Gen 1/2 has no SID; PID isn't in the cart, only
  // derived during conversion). Mirrors the dest stat-screen identity
  // strip's layout for easy visual comparison.
  const idRow = el('div', { class: 'source-details-id' });
  idRow.append(
    el('span', {}, `TID ${String(mon.tid).padStart(5, '0')}`),
    el('span', { class: 'source-details-sep' }, ' · '),
    el('span', {}, `OT ${ot}`),
  );
  inner.append(idRow);

  // DV table (Gen 1/2 stores 4-bit DVs, not Gen 3 IVs — but the
  // conversion is `IV = 2 * DV + b`. We show DVs so the user can
  // sanity-check the conversion the dest already underwent.).
  const dvTable = el('div', { class: 'source-details-dvs' });
  dvTable.append(el('div', { class: 'source-details-row-head' }, 'DVs'));
  dvTable.append(
    el(
      'div',
      { class: 'source-details-row' },
      `HP ${hpDv(mon.dvs)}  Atk ${mon.dvs.atk}  Def ${mon.dvs.def}  Spe ${mon.dvs.spe}  Spc ${mon.dvs.special}`,
    ),
  );
  inner.append(dvTable);

  const close = (): void => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') close();
  }
  const closeBtn = el(
    'button',
    { type: 'button', class: 'secondary' },
    'Close',
  ) as HTMLButtonElement;
  closeBtn.addEventListener('click', () => close());
  inner.append(closeBtn);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', onKey);
  overlay.append(inner);
  document.body.append(overlay);
}
