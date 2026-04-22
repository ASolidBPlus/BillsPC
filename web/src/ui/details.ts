/**
 * Conversion-details panel — shown beneath the side-by-side status screens
 * in the comparison overlay. Surfaces the underlying conversion math:
 * DV → IV mappings, StatExp → EV mappings (with the proportional-cap
 * factor when applicable), nature derivation, PID search outcome, SID
 * derivation source, and met data. The goal is full transparency about
 * what the conversion did to each field.
 */
import type { Gen12Pokemon, Gen3Intermediate } from '@pokeportal/core';
import { hpDv, NATURE_NAMES, decodeGen12 } from '@pokeportal/core/internal';
import { dialog } from './dialog.js';
import { el } from './dom.js';

export function conversionDetails(
  mon: Gen12Pokemon,
  intermediate: Gen3Intermediate,
): HTMLElement {
  const wrap = dialog({ class: 'conversion-details' });
  wrap.append(el('div', { class: 'details-header' }, 'CONVERSION DETAILS'));

  const ivBlock = el('div', { class: 'details-block' });
  ivBlock.append(el('div', { class: 'details-block-title' }, 'DV > IV'));
  const ivTable = el('table', { class: 'details-table' });
  const sourceHpDv = hpDv(mon.dvs);
  const ivRows: [string, number, string][] = [
    ['HP', sourceHpDv, String(intermediate.ivs.hp)],
    ['Atk', mon.dvs.atk, String(intermediate.ivs.atk)],
    ['Def', mon.dvs.def, String(intermediate.ivs.def)],
    ['Spe', mon.dvs.spe, String(intermediate.ivs.spe)],
    [
      'Spc',
      mon.dvs.special,
      `${intermediate.ivs.spa} / ${intermediate.ivs.spd} (split SpA/SpD)`,
    ],
  ];
  for (const [label, dv, iv] of ivRows) {
    const tr = el('tr');
    tr.append(
      el('td', { class: 'details-stat' }, label),
      el('td', { class: 'details-src' }, String(dv)),
      el('td', { class: 'details-arrow' }, '>'),
      el('td', { class: 'details-dst' }, iv),
    );
    ivTable.append(tr);
  }
  ivBlock.append(ivTable);
  wrap.append(ivBlock);

  const evBlock = el('div', { class: 'details-block' });
  evBlock.append(el('div', { class: 'details-block-title' }, 'StatExp > EV'));
  const evTable = el('table', { class: 'details-table' });
  const evRows: [string, number, string][] = [
    ['HP', mon.statExp.hp, String(intermediate.evs.hp)],
    ['Atk', mon.statExp.atk, String(intermediate.evs.atk)],
    ['Def', mon.statExp.def, String(intermediate.evs.def)],
    ['Spe', mon.statExp.spe, String(intermediate.evs.spe)],
    [
      'Spc',
      mon.statExp.special,
      `${intermediate.evs.spa} / ${intermediate.evs.spd} (split SpA/SpD)`,
    ],
  ];
  for (const [label, se, ev] of evRows) {
    const tr = el('tr');
    tr.append(
      el('td', { class: 'details-stat' }, label),
      el('td', { class: 'details-src' }, String(se)),
      el('td', { class: 'details-arrow' }, '>'),
      el('td', { class: 'details-dst' }, ev),
    );
    evTable.append(tr);
  }
  const evSum =
    intermediate.evs.hp +
    intermediate.evs.atk +
    intermediate.evs.def +
    intermediate.evs.spa +
    intermediate.evs.spd +
    intermediate.evs.spe;
  const seSum =
    mon.statExp.hp +
    mon.statExp.atk +
    mon.statExp.def +
    mon.statExp.spe +
    mon.statExp.special * 2; // mirror split: special counts as both spa+spd
  const sumRow = el('tr', { class: 'details-sum' });
  sumRow.append(
    el('td', { class: 'details-stat' }, 'Σ'),
    el('td', { class: 'details-src' }, String(seSum)),
    el('td', { class: 'details-arrow' }, '→'),
    el('td', { class: 'details-dst' }, `${evSum} (cap 510)`),
  );
  evTable.append(sumRow);
  evBlock.append(evTable);
  if (evSum === 510) {
    evBlock.append(
      el(
        'div',
        { class: 'details-note' },
        'EVs proportionally scaled to the 510 cap; remainder distributed via Hamilton method.',
      ),
    );
  }
  wrap.append(evBlock);

  const metaBlock = el('div', { class: 'details-block' });
  metaBlock.append(el('div', { class: 'details-block-title' }, 'Identity'));
  const metaTable = el('table', { class: 'details-table' });
  const natureName = NATURE_NAMES[intermediate.nature] ?? `nature-${intermediate.nature}`;
  const natureBucket = ((mon.dvs.atk << 4) | mon.dvs.def) % 5;
  const pidIters = intermediate._meta.pidSearchIterations;
  const otName = decodeGen12(mon.otNameBytes) || '(unknown)';
  const metaRows: [string, string][] = [
    ['OT', `${otName}  (TID ${intermediate.tid}, SID ${intermediate.sid})`],
    ['Nature', `${natureName}  (#${intermediate.nature}, bucket ${natureBucket}, neutral)`],
    [
      'PID',
      `0x${intermediate.pid.toString(16).padStart(8, '0')}  (${pidIters} iter${pidIters === 1 ? '' : 's'})`,
    ],
    [
      'Met',
      `Four Island, FRLG, met-level ${intermediate.metLevel} (hatched egg)`,
    ],
    ['Ability', `slot ${intermediate.abilitySlot}`],
  ];
  for (const [label, value] of metaRows) {
    const tr = el('tr');
    tr.append(el('td', { class: 'details-stat' }, label), el('td', { colspan: '3' }, value));
    metaTable.append(tr);
  }
  metaBlock.append(metaTable);
  wrap.append(metaBlock);

  const carryBlock = el('div', { class: 'details-block' });
  carryBlock.append(el('div', { class: 'details-block-title' }, 'Carryover'));
  const carryTable = el('table', { class: 'details-table' });
  const carryRows: [string, string][] = [
    ['Item', intermediate.heldItem === 0 ? 'none' : `id ${intermediate.heldItem}`],
    ['Friendship', String(intermediate.friendship)],
    ['Pokerus', intermediate.pokerus === 0 ? 'clean' : `0x${intermediate.pokerus.toString(16)}`],
    ['EXP', String(intermediate.exp)],
  ];
  for (const [label, value] of carryRows) {
    const tr = el('tr');
    tr.append(el('td', { class: 'details-stat' }, label), el('td', { colspan: '3' }, value));
    carryTable.append(tr);
  }
  carryBlock.append(carryTable);
  wrap.append(carryBlock);

  if (intermediate._meta.warnings.length > 0) {
    const warnBlock = el('div', { class: 'details-block' });
    warnBlock.append(el('div', { class: 'details-block-title' }, 'Warnings'));
    for (const w of intermediate._meta.warnings) {
      warnBlock.append(el('div', { class: 'details-warning' }, w));
    }
    wrap.append(warnBlock);
  }

  return wrap;
}
