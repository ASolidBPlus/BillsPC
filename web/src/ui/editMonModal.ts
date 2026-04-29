/**
 * S10 — manual edit modal for Gen 3 mons.
 *
 * Form fields: PID (8 hex), TID, SID, 6 IVs, OT name. Live-derived
 * shiny / nature / ability indicators recompute on every input change.
 *
 * D6 click-through semantics: validators that flag a problem (IV out
 * of range, OT-name '?' substitution) surface a confirm dialog with
 * "Apply anyway"; the user is never hard-blocked except for inputs
 * that wouldn't even type-coerce (e.g. wrong-length hex PID).
 */

import {
  unpackBoxed,
  isDecodeError,
  validatePid,
  validateTid,
  validateSid,
  validateIv,
  validateOtName,
  parsePid,
  type Validation,
} from '@pokeportal/core';
import type { Gen3MonEdits } from '../state.js';
import { el } from './dom.js';

const NATURE_NAMES: readonly string[] = [
  'Hardy',
  'Lonely',
  'Brave',
  'Adamant',
  'Naughty',
  'Bold',
  'Docile',
  'Relaxed',
  'Impish',
  'Lax',
  'Timid',
  'Hasty',
  'Serious',
  'Jolly',
  'Naive',
  'Modest',
  'Mild',
  'Quiet',
  'Bashful',
  'Rash',
  'Calm',
  'Gentle',
  'Sassy',
  'Careful',
  'Quirky',
];

export interface EditMonModalOpts {
  readonly currentSlot: Uint8Array;
  readonly boxIndex: number;
  readonly slot: number;
  readonly onApply: (edits: Gen3MonEdits) => void;
  readonly onCancel: () => void;
}

interface FieldState {
  pid: string;
  tid: string;
  sid: string;
  hp: string;
  atk: string;
  def: string;
  spa: string;
  spd: string;
  spe: string;
  ot: string;
}

interface DerivedDisplay {
  shiny: boolean;
  natureName: string;
  abilitySlot: 0 | 1;
}

function computeDerived(pid: number, tid: number, sid: number): DerivedDisplay {
  const pidHigh = (pid >>> 16) & 0xffff;
  const pidLow = pid & 0xffff;
  const shiny = ((tid ^ sid ^ pidHigh ^ pidLow) & 0x07) === 0;
  const natureName = NATURE_NAMES[(pid >>> 0) % 25] ?? '?';
  const abilitySlot: 0 | 1 = (pid & 1) === 0 ? 0 : 1;
  return { shiny, natureName, abilitySlot };
}

/**
 * Compose the `Gen3MonEdits` payload from the current field strings.
 * Invalid fields are simply omitted (the click-handler runs validators
 * up front and refuses to call `onApply` if anything's a hard block).
 */
function buildEdits(
  fields: FieldState,
  baselineOt: string,
): { edits: Gen3MonEdits; warnings: string[] } {
  const edits: { -readonly [K in keyof Gen3MonEdits]: Gen3MonEdits[K] } = {};
  const warnings: string[] = [];
  const pid = parsePid(fields.pid);
  if (pid !== null) edits.pid = pid;
  const tid = Number(fields.tid);
  if (Number.isInteger(tid) && tid >= 0 && tid <= 0xffff) edits.tid = tid;
  const sid = Number(fields.sid);
  if (Number.isInteger(sid) && sid >= 0 && sid <= 0xffff) edits.sid = sid;
  const ivPair = (s: string): number | null => {
    const n = Number(s);
    if (!Number.isInteger(n)) return null;
    return Math.max(0, Math.min(31, n));
  };
  const ivs = {
    hp: ivPair(fields.hp),
    atk: ivPair(fields.atk),
    def: ivPair(fields.def),
    spa: ivPair(fields.spa),
    spd: ivPair(fields.spd),
    spe: ivPair(fields.spe),
  };
  const anyIv = Object.values(ivs).some((v) => v !== null);
  if (anyIv) {
    const finalIvs: { -readonly [K in keyof NonNullable<Gen3MonEdits['ivs']>]: number } = {
      hp: ivs.hp ?? 0,
      atk: ivs.atk ?? 0,
      def: ivs.def ?? 0,
      spa: ivs.spa ?? 0,
      spd: ivs.spd ?? 0,
      spe: ivs.spe ?? 0,
    };
    edits.ivs = finalIvs;
  }
  if (fields.ot !== baselineOt) {
    edits.otName = fields.ot;
  }
  return { edits, warnings };
}

export function openEditMonModal(opts: EditMonModalOpts): void {
  // Defensive: dispose any prior overlay.
  for (const node of Array.from(document.body.querySelectorAll('.edit-mon-overlay'))) {
    node.remove();
  }

  // Decode the current slot to seed initial field values.
  // Patch mode decodes arbitrary on-cart mons — pass permissive so the
  // S1-only literal-field checks (ribbons === 0, ball === Poke Ball,
  // origin === FireRed, isEgg === false) don't reject mons that earned
  // a ribbon in-game, were caught in a different ball, originated from
  // a different game, or carry the Mew-style obedience bit.
  const decoded = unpackBoxed(opts.currentSlot, { permissive: true });
  if (isDecodeError(decoded)) {
    console.error('[edit-modal] unpack failed:', decoded.reason, decoded.message);
    opts.onCancel();
    return;
  }

  // Best-effort decode of the OT bytes. The modal lets the user retype
  // OT freely; the validator handles round-trip safety.
  const otString = decodeOtBytes(decoded.otName);

  const fields: FieldState = {
    pid: decoded.pid.toString(16).toUpperCase().padStart(8, '0'),
    tid: String(decoded.tid),
    sid: String(decoded.sid),
    hp: String(decoded.ivs.hp),
    atk: String(decoded.ivs.atk),
    def: String(decoded.ivs.def),
    spa: String(decoded.ivs.spa),
    spd: String(decoded.ivs.spd),
    spe: String(decoded.ivs.spe),
    ot: otString,
  };
  const baselineOt = otString;

  const overlay = el('div', { class: 'edit-mon-overlay' });
  const inner = el('div', { class: 'edit-mon-inner card' });
  inner.append(
    el('div', { class: 'edit-mon-title' }, 'EDIT MON — manual cart correction'),
    el(
      'div',
      { class: 'edit-mon-meta' },
      `box ${opts.boxIndex + 1} slot ${opts.slot + 1} · species ${decoded.species}`,
    ),
  );

  // Derived-display row (shiny / nature / ability), recomputed on
  // every change.
  const derivedRow = el('div', { class: 'edit-mon-derived' });
  inner.append(derivedRow);

  // Build the form. Each field is a labeled input + an inline validator
  // hint that updates on `input`.
  const form = el('div', { class: 'edit-mon-form' });
  const ctrls: Record<string, HTMLInputElement> = {};
  const hints: Record<string, HTMLElement> = {};

  const addField = (
    key: keyof FieldState,
    label: string,
    validate: (v: string) => Validation,
    cls: string,
  ): void => {
    const row = el('div', { class: `edit-mon-row ${cls}` });
    row.append(el('label', {}, label));
    const input = el('input', {
      type: 'text',
      value: fields[key],
      class: `edit-mon-input edit-mon-input-${key}`,
    }) as HTMLInputElement;
    const hint = el('div', { class: 'edit-mon-hint' });
    input.addEventListener('input', () => {
      fields[key] = input.value;
      const v = validate(input.value);
      hint.textContent = v.ok ? '' : v.message;
      hint.className = `edit-mon-hint${v.ok ? '' : v.canOverride ? ' warn' : ' error'}`;
      refreshDerived();
    });
    row.append(input, hint);
    form.append(row);
    ctrls[key] = input;
    hints[key] = hint;
  };

  addField('pid', 'PID (hex)', validatePid, 'edit-mon-row-pid');
  addField('tid', 'TID', validateTid, 'edit-mon-row-tid');
  addField('sid', 'SID', validateSid, 'edit-mon-row-sid');
  addField('hp', 'HP IV', validateIv, 'edit-mon-row-iv');
  addField('atk', 'Atk IV', validateIv, 'edit-mon-row-iv');
  addField('def', 'Def IV', validateIv, 'edit-mon-row-iv');
  addField('spa', 'SpA IV', validateIv, 'edit-mon-row-iv');
  addField('spd', 'SpD IV', validateIv, 'edit-mon-row-iv');
  addField('spe', 'Spe IV', validateIv, 'edit-mon-row-iv');
  addField('ot', 'OT name', validateOtName, 'edit-mon-row-ot');

  inner.append(form);

  const refreshDerived = (): void => {
    const pid = parsePid(fields.pid);
    const tid = Number(fields.tid);
    const sid = Number(fields.sid);
    if (pid === null || !Number.isInteger(tid) || !Number.isInteger(sid)) {
      derivedRow.replaceChildren(
        el('span', { class: 'edit-mon-derived-bad' }, '(invalid PID/TID/SID — fix to see derived)'),
      );
      return;
    }
    const d = computeDerived(pid, tid & 0xffff, sid & 0xffff);
    derivedRow.replaceChildren(
      el(
        'span',
        { class: `edit-mon-derived-shiny${d.shiny ? ' shiny' : ''}` },
        d.shiny ? 'SHINY' : 'not shiny',
      ),
      el('span', { class: 'edit-mon-derived-sep' }, ' · '),
      el('span', { class: 'edit-mon-derived-nature' }, `nature ${d.natureName}`),
      el('span', { class: 'edit-mon-derived-sep' }, ' · '),
      el('span', { class: 'edit-mon-derived-ability' }, `ability slot ${d.abilitySlot}`),
    );
  };
  refreshDerived();

  // Action buttons.
  const actions = el('div', { class: 'edit-mon-actions' });
  const cancel = el(
    'button',
    { type: 'button', class: 'secondary' },
    'Cancel',
  ) as HTMLButtonElement;
  const apply = el(
    'button',
    { type: 'button', class: 'primary edit-mon-apply' },
    'Apply',
  ) as HTMLButtonElement;

  const close = (): void => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      close();
      opts.onCancel();
    }
  }

  cancel.addEventListener('click', () => {
    close();
    opts.onCancel();
  });
  apply.addEventListener('click', () => {
    // Run validators. Hard blocks (canOverride !== true) refuse the
    // apply outright. Warnings (canOverride === true) trigger a
    // confirm dialog (D6 click-through).
    const checks: Array<{ field: string; result: Validation }> = [
      { field: 'PID', result: validatePid(fields.pid) },
      { field: 'TID', result: validateTid(fields.tid) },
      { field: 'SID', result: validateSid(fields.sid) },
      { field: 'HP IV', result: validateIv(fields.hp) },
      { field: 'Atk IV', result: validateIv(fields.atk) },
      { field: 'Def IV', result: validateIv(fields.def) },
      { field: 'SpA IV', result: validateIv(fields.spa) },
      { field: 'SpD IV', result: validateIv(fields.spd) },
      { field: 'Spe IV', result: validateIv(fields.spe) },
      { field: 'OT name', result: validateOtName(fields.ot) },
    ];
    const hardFails = checks.filter((c) => !c.result.ok && !c.result.canOverride);
    if (hardFails.length > 0) {
      // Surface the first hard fail inline (the per-field hint is already
      // visible; we just refuse to dispatch).
      console.warn('[edit-modal] refused: hard validation failures:', hardFails);
      return;
    }
    const warns = checks.filter((c) => !c.result.ok);
    const proceed = (): void => {
      const built = buildEdits(fields, baselineOt);
      close();
      opts.onApply(built.edits);
    };
    if (warns.length > 0) {
      // D6 — confirm-then-apply. The user can always click through.
      const message =
        `${warns.length} field${warns.length === 1 ? '' : 's'} flagged as potentially incorrect:\n` +
        warns.map((w) => `  • ${w.field}: ${w.result.ok ? '' : w.result.message}`).join('\n') +
        '\n\nApply anyway?';
      // Use a synchronous confirm dialog. JSDOM has window.confirm
      // stubbed; we avoid it for testability and render an explicit
      // confirm card.
      openConfirmCard(message, () => proceed());
      return;
    }
    proceed();
  });
  actions.append(cancel, apply);
  inner.append(actions);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      close();
      opts.onCancel();
    }
  });
  document.addEventListener('keydown', onKey);
  overlay.append(inner);
  document.body.append(overlay);
}

/** Decode 7-byte OT field to a best-effort ASCII representation. */
function decodeOtBytes(bytes: Uint8Array): string {
  // The OT bytes are Gen 3 charmap-encoded; we don't have a direct
  // decoder exposed for ASCII output here, so we strip the 0xFF
  // terminator and return whatever the bytes-to-printable mapping
  // produces. The user retypes OT manually anyway.
  let s = '';
  for (const b of bytes) {
    if (b === 0xff) break;
    // Gen 3 EN: A=0xBB..0xD4, a=0xD5..0xEE, 0=0xA1..0xAA, ' '=0x00 etc.
    if (b >= 0xbb && b <= 0xd4) s += String.fromCharCode(0x41 + (b - 0xbb));
    else if (b >= 0xd5 && b <= 0xee) s += String.fromCharCode(0x61 + (b - 0xd5));
    else if (b >= 0xa1 && b <= 0xaa) s += String.fromCharCode(0x30 + (b - 0xa1));
    else if (b === 0x00) s += ' ';
    else s += '?';
  }
  return s;
}

/** Promise-style confirm card used for the D6 click-through path. */
function openConfirmCard(message: string, onConfirm: () => void): void {
  const overlay = el('div', { class: 'edit-mon-confirm-overlay' });
  const inner = el('div', { class: 'edit-mon-confirm-inner card' });
  inner.append(el('pre', { class: 'edit-mon-confirm-message' }, message));
  const btns = el('div', { class: 'edit-mon-confirm-actions' });
  const cancel = el(
    'button',
    { type: 'button', class: 'secondary' },
    'Cancel',
  ) as HTMLButtonElement;
  const proceed = el(
    'button',
    { type: 'button', class: 'primary edit-mon-confirm-apply' },
    'Apply anyway',
  ) as HTMLButtonElement;
  const close = (): void => overlay.remove();
  cancel.addEventListener('click', () => close());
  proceed.addEventListener('click', () => {
    close();
    onConfirm();
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  btns.append(cancel, proceed);
  inner.append(btns);
  overlay.append(inner);
  document.body.append(overlay);
}
