/**
 * S10 — manual patch-mode workbench shell.
 *
 * Two-column layout: source LEFT (read-only reference), destination
 * RIGHT (browsable; click any mon to open `editMonModal` for manual
 * PID/TID/SID/IV/OT edits). Source can be loaded EITHER from a cart
 * connect OR from a `.sav` upload (D8 — both paths produce the same
 * read-only `SaveContents`).
 *
 * Without `?patch=1` this module is never imported (the controller
 * branches in `ui.ts`).
 */

import type {
  Gen12Pokemon,
  Gen3Intermediate,
  Gen3SaveContents,
  SaveContents,
  SaveFormat,
} from '@pokeportal/core';
import type { Gen3MonEdits, MonRef, PatchSession } from '../state.js';
import { el } from './dom.js';
import { destBoxBrowser } from './destBoxBrowser.js';
import { boxBrowser, entriesForBox } from './boxBrowser.js';
import { textDialog } from './dialog.js';
import { openEditMonModal } from './editMonModal.js';
import { openStatScreenModal } from './statScreen.js';

export interface PatchModeProps {
  readonly session: PatchSession;
  readonly cartAvailable: boolean;
  /** S10 D8 — load source from a connected Gen 1/2/3 cart. */
  readonly onLoadSourceCart: () => void;
  /** S10 D8 — load source from an uploaded .sav file (any supported family). */
  readonly onLoadSourceSav: (file: File) => void;
  readonly onLoadDestCart: () => void;
  readonly onLoadDestSav: (file: File) => void;
  readonly onSourceMonOpen?: (ref: MonRef) => void;
  /** Called when the user applies an edit in the modal — patcher's
   *  responsibility lives in the controller; this prop is just the
   *  dispatch hook. */
  readonly onEditApplied?: (boxIndex: number, slot: number, edits: Gen3MonEdits) => void;
  /** Used by source-mon click to render the BEFORE/AFTER stat-inspect
   *  modal (with computed Gen 3 PID / SID / TID / IVs the user types
   *  into the dest edit modal manually). */
  readonly convert?: (mon: Gen12Pokemon) => Gen3Intermediate | null;
  /** Called when the user clicks "Flash patches to cart". Only enabled
   *  when `session.pendingEdits.size > 0` AND `session.dest` is set.
   *  Hooks into the existing `runCommitDestination` flow which already
   *  branches on `pendingEdits.size > 0` to use the patch composer. */
  readonly onFlashPatches?: () => void;
  /** Source/dest box-browser nav callbacks — both panes lift their
   *  boxIndex into PatchSession state so patch_edit_applied dispatches
   *  don't reset the box back to 1. */
  readonly onSourceBoxChange?: (boxIndex: number) => void;
  readonly onDestBoxChange?: (boxIndex: number) => void;
}

export function renderPatchMode(props: PatchModeProps): HTMLElement {
  const root = el('div', { class: 'patch-mode' });

  // Header — explicit ADVANCED warning + "refresh = lose corrections"
  // notice. Per RA-2 #1 + R7: pendingEdits are in-memory only.
  const header = el('div', { class: 'patch-mode-header card' });
  header.append(
    el('div', { class: 'patch-mode-title' }, 'PATCH MODE — manual cart correction'),
    el(
      'div',
      { class: 'patch-mode-warn' },
      'Advanced. ALWAYS keep a backup of any cart before flashing patched bytes. Refresh = lose corrections (in-memory only).',
    ),
  );
  if (props.session.pendingEdits.size > 0) {
    const pendingRow = el('div', { class: 'patch-mode-pending-row' });
    pendingRow.append(
      el(
        'div',
        { class: 'patch-mode-pending' },
        `${props.session.pendingEdits.size} pending edit${
          props.session.pendingEdits.size === 1 ? '' : 's'
        } staged.`,
      ),
    );
    if (props.onFlashPatches && props.session.dest) {
      const flashBtn = el(
        'button',
        { class: 'primary patch-flash-btn', type: 'button' },
        'Flash patches to cart',
      ) as HTMLButtonElement;
      flashBtn.addEventListener('click', () => props.onFlashPatches?.());
      pendingRow.append(flashBtn);
    }
    header.append(pendingRow);
  }
  root.append(header);

  const grid = el('div', { class: 'patch-mode-grid' });
  grid.append(renderSourceColumn(props));
  grid.append(renderDestColumn(props));
  root.append(grid);

  return root;
}

function renderSourceColumn(props: PatchModeProps): HTMLElement {
  const col = el('div', { class: 'patch-source-col pane' });
  col.append(el('div', { class: 'pane-label' }, 'SOURCE (read-only reference)'));

  if (props.session.source) {
    const src = props.session.source;
    col.append(
      textDialog(
        [
          `LOADED  ${src.cartLabel}`,
          `TRAINER  ${src.save.trainer.name || '(no name)'}`,
          `ID No.  ${src.save.trainer.tid}`,
        ],
        { class: 'trainer-dialog patch-source-summary' },
      ),
    );
    col.append(
      renderReadOnlySourceBrowser(
        src.save,
        props.session.sourceBoxIndex,
        props.onSourceBoxChange,
        props.convert,
        props.onSourceMonOpen,
      ),
    );
    return col;
  }

  // No source loaded — both entry points (per D8).
  const cartBtn = el(
    'button',
    { class: 'primary', type: 'button' },
    'Connect source cart',
  ) as HTMLButtonElement;
  if (!props.cartAvailable) {
    cartBtn.setAttribute('disabled', 'disabled');
    cartBtn.setAttribute('title', 'Web Serial unavailable — use the SAV upload below instead.');
  }
  cartBtn.addEventListener('click', () => props.onLoadSourceCart());

  const orRow = el('div', { class: 'patch-or-row' }, 'or');

  const dropzone = el('div', { class: 'drop-zone patch-source-dropzone' });
  dropzone.append(el('div', {}, 'Upload a source .sav for reference:'));
  const input = el('input', {
    type: 'file',
    accept: '',
    class: 'patch-source-file-input',
  }) as HTMLInputElement;
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (f) props.onLoadSourceSav(f);
  });
  dropzone.append(input);
  dropzone.append(
    el(
      'div',
      { class: 'hint' },
      'Any supported family (Gen 1/2 .sav or Gen 3 .sav). Read-only reference; never written to.',
    ),
  );
  dropzone.addEventListener('dragover', (ev) => {
    ev.preventDefault();
    dropzone.classList.add('drag-over');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
  dropzone.addEventListener('drop', (ev) => {
    ev.preventDefault();
    dropzone.classList.remove('drag-over');
    const f = ev.dataTransfer?.files?.[0];
    if (f) props.onLoadSourceSav(f);
  });

  col.append(cartBtn, orRow, dropzone);
  return col;
}

function renderReadOnlySourceBrowser(
  save: SaveContents,
  initialBoxIndex: number,
  onBoxChange?: (boxIndex: number) => void,
  convert?: (mon: Gen12Pokemon) => Gen3Intermediate | null,
  onMonOpen?: (ref: MonRef) => void,
): HTMLElement {
  const wrap = el('div', { class: 'patch-source-browser' });
  // Source pane: boxIndex hoisted into PatchSession so re-renders
  // triggered by patch_edit_applied don't snap the source back to box 1.
  // Cursor stays local — it's purely visual.
  let boxIndex = initialBoxIndex;
  let cursor = { row: 0, col: 0 };
  const renderInto = (host: HTMLElement): void => {
    host.replaceChildren();
    const entries = entriesForBox(save, boxIndex);
    host.append(
      boxBrowser({
        save,
        boxIndex,
        cursor,
        entries,
        onCursorMove: (drow, dcol) => {
          cursor = {
            row: clamp(cursor.row + drow, 0, 4),
            col: clamp(cursor.col + dcol, 0, 3),
          };
          renderInto(host);
        },
        onBoxChange: (delta) => {
          const stored = save.boxes.length;
          const live = save.currentBox ? 1 : 0;
          const max = Math.max(0, stored + live - 1);
          boxIndex = clamp(boxIndex + delta, 0, max);
          cursor = { row: 0, col: 0 };
          // Persist into PatchSession so a parent-driven re-render keeps
          // this box selected.
          if (onBoxChange) onBoxChange(boxIndex);
          renderInto(host);
        },
        onMonOpen: (ref) => {
          // S10 Stage 3 — clicking a source mon opens the FULL existing
          // STAT INSPECT modal (BEFORE = source DV/StatExp; AFTER =
          // computed Gen 3 PID/SID/TID/IVs from convert). The user reads
          // the AFTER values + types them into the dest edit modal.
          const mon = monAtRef(save, ref);
          if (mon) {
            openStatScreenModal({
              subject: { kind: 'sourceMon', mon, sourceFormat: save.format },
              ...(convert ? { convert } : {}),
            });
          }
          if (onMonOpen) onMonOpen(ref);
        },
      }),
    );
  };
  renderInto(wrap);
  return wrap;
}

function monAtRef(save: SaveContents, ref: MonRef): Gen12Pokemon | null {
  if (ref.bucket === 'party') return save.party[ref.slot] ?? null;
  if (ref.bucket === 'currentBox') return save.currentBox?.[ref.slot] ?? null;
  return save.boxes[ref.boxIndex ?? 0]?.[ref.slot] ?? null;
}

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

function renderDestColumn(props: PatchModeProps): HTMLElement {
  const col = el('div', { class: 'patch-dest-col pane' });
  col.append(el('div', { class: 'pane-label' }, 'DESTINATION (Gen 3 — click to edit)'));

  if (props.session.dest) {
    const dst = props.session.dest;
    col.append(
      textDialog(
        [
          `LOADED  ${dst.cartLabel}`,
          `TID  ${dst.save.trainer.tid}`,
          `SID  ${dst.save.trainer.sid}`,
        ],
        { class: 'trainer-dialog patch-dest-summary' },
      ),
    );
    col.append(renderEditableDestBrowser(dst.save, props));
    return col;
  }

  const cartBtn = el(
    'button',
    { class: 'primary', type: 'button' },
    'Connect destination cart',
  ) as HTMLButtonElement;
  if (!props.cartAvailable) {
    cartBtn.setAttribute('disabled', 'disabled');
    cartBtn.setAttribute('title', 'Web Serial unavailable — use the SAV upload below instead.');
  }
  cartBtn.addEventListener('click', () => props.onLoadDestCart());

  const orRow = el('div', { class: 'patch-or-row' }, 'or');

  const dropzone = el('div', { class: 'drop-zone patch-dest-dropzone' });
  dropzone.append(el('div', {}, 'Upload a destination Gen 3 .sav:'));
  const input = el('input', {
    type: 'file',
    accept: '',
    class: 'patch-dest-file-input',
  }) as HTMLInputElement;
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (f) props.onLoadDestSav(f);
  });
  dropzone.append(input);
  dropzone.append(
    el(
      'div',
      { class: 'hint' },
      'Ruby, Sapphire, Emerald, FireRed, LeafGreen (English; 64 KB or 128 KB).',
    ),
  );
  dropzone.addEventListener('dragover', (ev) => {
    ev.preventDefault();
    dropzone.classList.add('drag-over');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
  dropzone.addEventListener('drop', (ev) => {
    ev.preventDefault();
    dropzone.classList.remove('drag-over');
    const f = ev.dataTransfer?.files?.[0];
    if (f) props.onLoadDestSav(f);
  });

  col.append(cartBtn, orRow, dropzone);
  return col;
}

function renderEditableDestBrowser(save: Gen3SaveContents, props: PatchModeProps): HTMLElement {
  const wrap = el('div', { class: 'patch-dest-browser' });
  let boxIndex = props.session.destBoxIndex;
  let cursor = { row: 0, col: 0 };
  const renderInto = (host: HTMLElement): void => {
    host.replaceChildren();
    host.append(
      destBoxBrowser({
        save,
        boxIndex,
        cursor,
        onCursorMove: (drow, dcol) => {
          cursor = {
            row: clamp(cursor.row + drow, 0, 4),
            col: clamp(cursor.col + dcol, 0, 5),
          };
          renderInto(host);
        },
        onBoxChange: (delta) => {
          boxIndex = clamp(boxIndex + delta, 0, 13);
          cursor = { row: 0, col: 0 };
          if (props.onDestBoxChange) props.onDestBoxChange(boxIndex);
          renderInto(host);
        },
        onSlotClick: (slot) => {
          // Patch-mode: click on a filled slot opens the edit modal.
          // Empty slots just move the cursor (no edit semantics).
          const row = Math.floor(slot / 6);
          const col = slot % 6;
          cursor = { row, col };
          const slotData = save.pc.boxes[boxIndex]?.[slot];
          if (slotData?.kind === 'filled') {
            // Pre-fill the modal with any pending edit for this slot, so
            // re-opening after Apply shows the EDITED values, not the
            // pre-edit cart bytes (which haven't been flashed yet).
            const pending = props.session.pendingEdits.get(`${boxIndex}:${slot}`);
            openEditMonModal({
              currentSlot: slotData.bytes,
              boxIndex,
              slot,
              ...(pending ? { pendingEdit: pending } : {}),
              onApply: (edits) => {
                props.onEditApplied?.(boxIndex, slot, edits);
              },
              onCancel: () => {},
            });
          } else {
            renderInto(host);
          }
        },
      }),
    );
  };
  renderInto(wrap);
  return wrap;
}
