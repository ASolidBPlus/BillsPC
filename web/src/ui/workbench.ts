/**
 * S8v2 workbench layout — built directly from the user's mock (chat
 * 2026-04-25). Two symmetric dotted-bordered panes with a "TRADING PIPE"
 * visual chrome between them; action buttons stack below each pane.
 *
 * Pane LEFT carries an interpolated role label `{SOURCE / DESTINATION}`
 * — both roles use the same physical pane; the user toggles via the
 * "SWITCH TO …" button below. Pane RIGHT is always the Temp Box (a
 * literal Gen 3 5×6 box browser; same UI as `destBoxBrowser`).
 *
 * S8v2.1 extends the LEFT pane with three sub-states per role
 * (loading / loaded / error overlaid on the same outer chrome). The
 * loading-state overlay is a MODAL (per AMEND-S8v2.1-11) appended to
 * `document.body`, NOT an inline card — so the workbench renderer
 * still returns a single root and the modal floats above it.
 */

import type { Gen3SaveContents, SaveContents } from '@pokeportal/core';
import { el } from './dom.js';
import { boxBrowser, entriesForBox, type SelectModifiers } from './boxBrowser.js';
import { destBoxBrowser } from './destBoxBrowser.js';
import { spriteImg } from './sprites.js';
import { cartProgress } from './cartProgress.js';
import type { Cursor, DestCursor, MonRef } from '../state.js';
import type { StagedSlot } from '../cart/stagingStore.types.js';

export type LeftRole = 'source' | 'destination';

export interface SourceLoadedView {
  readonly save: SaveContents;
  readonly boxIndex: number;
  readonly cursor: Cursor;
  readonly fileName: string;
}

export interface DestLoadedView {
  readonly save: Gen3SaveContents;
  readonly boxIndex: number;
  readonly cursor: DestCursor;
  readonly fileName: string;
}

export interface CartLoadingView {
  readonly bytesRead: number;
  readonly bytesTotal: number;
  readonly phase?: 'connecting' | 'detecting' | 'reading' | 'parsing';
  /**
   * Optional human-friendly device label shown under the progress bar
   * (mirrors the legacy `cartProgress` `label` arg).
   */
  readonly label?: string;
}

export interface SavParsingView {
  readonly fileName: string;
  readonly size: number;
}

export interface LoadErrorView {
  readonly reason: string;
  readonly message: string;
  readonly rawBytes?: Uint8Array;
  readonly rawFileName?: string;
}

export interface PreviewedPlacement {
  readonly speciesId: number;
  readonly nicknameDisplay: string;
  readonly transferBoxIdx: number;
}

export interface WorkbenchProps {
  readonly leftRole: LeftRole;
  readonly sourceLoaded: SourceLoadedView | null;
  /** Cart-read in flight on the source side. */
  readonly sourceCartLoading: CartLoadingView | null;
  /** SAV-parse in flight on the source side (no progress bar — text only). */
  readonly sourceSavParsing: SavParsingView | null;
  readonly sourceError: LoadErrorView | null;
  readonly destLoaded: DestLoadedView | null;
  readonly destCartLoading: CartLoadingView | null;
  readonly destSavParsing: SavParsingView | null;
  readonly destError: LoadErrorView | null;
  readonly onLoadCart: (role: LeftRole) => void;
  readonly onLoadSav: (role: LeftRole, file: File) => void;
  readonly onSwitchRole: () => void;
  readonly onSourceBoxChange: (delta: -1 | 1) => void;
  readonly onSourceCursorMove: (drow: -1 | 0 | 1, dcol: -1 | 0 | 1) => void;
  /** S8v2.2 — selection toggle for the source LEFT pane.
   *  S8v2.1 named this `onSourceMonOpen`; renamed to reflect that the
   *  click is a selection gesture, not a "open comparison overlay" one
   *  (the overlay was deliberately removed from v2 per §8). */
  readonly onSourceMonClick: (ref: MonRef, modKeys: SelectModifiers) => void;
  readonly onDestBoxChange: (delta: -1 | 1) => void;
  readonly onDestCursorMove: (drow: -1 | 0 | 1, dcol: -1 | 0 | 1) => void;
  /** S8v2.2 — selection toggle for the dest LEFT pane (per
   *  DECISION-S8v2.2-3). Plain click on filled slot → cursor + replace
   *  selection; cmd-click → toggle selection only (no cursor move);
   *  shift-click → range-extend + cursor; click on empty slot →
   *  cursor + clear selection (cmd-click on empty is a no-op). */
  readonly onDestSlotClick: (slot: number, modKeys: SelectModifiers) => void;
  /** S8v2.2 — RIGHT pane TRANSFER BOX tile click. Fires for filled
   *  slots in EITHER role (S8v2.2-polish: a plain click in source role
   *  opens the stat-screen modal; in destination role it falls through
   *  to selection toggling per modifier keys). The empty-slot click is
   *  still suppressed at render time. */
  readonly onTransferTileClick: (idx: number, modKeys: SelectModifiers) => void;
  /** S8v2.2-polish — invoked when the controller wants to surface the
   *  stat-screen modal for a transfer-box slot regardless of role. The
   *  workbench itself doesn't open modals; the controller wires this to
   *  `openStatScreenModal`. Optional so legacy tests still compile. */
  readonly onTransferTileViewStats?: (idx: number) => void;
  /** S8v2.2-polish — bulk-select handlers for the LEFT pane. Each
   *  populates the relevant selection array with every occupied slot in
   *  the currently-visible box. Optional so legacy tests still compile. */
  readonly onSelectAllSourceBox?: () => void;
  readonly onSelectAllDestBox?: () => void;
  readonly onSelectAllTransferBox?: () => void;
  /** S8v2.2 stub / S8v2.3 implementation — actually-write-to-cart. */
  readonly onCommit?: () => void;
  readonly onSelectSourceParty?: () => void;
  /** Dispatch source_clear / dest_clear so the user can retry after a parse fail. */
  readonly onErrorDismiss: (role: LeftRole) => void;
  /** User-initiated full pane reset — clears the loaded source/dest
   *  data so the box returns to its empty placeholder state. */
  readonly onPaneReset: (role: LeftRole) => void;
  readonly onDownloadRawCartDump?: (role: LeftRole) => void;
  // existing optional handlers kept for v2.0 parity (RIGHT pane stays empty/disabled)
  readonly onBackupToSav?: () => void;
  // S8v2.2 — role-specific add buttons (replace the old single
  // `onAddSelected`). Each is enabled by the controller only when the
  // corresponding role + selection state allows it.
  readonly onAddSelectedToTransfer?: () => void;
  readonly onAddSelectedToDestination?: () => void;
  readonly onClearTransferBox: () => void;
  readonly onExportTransferBoxJson?: () => void;
  readonly onImportTransferBoxJson?: (file: File) => void;
  readonly onDismissTransferBoxFullBanner: () => void;
  readonly onDismissTransferPlacementBanner: () => void;
  readonly onDismissTransferConvertSkipBanner: () => void;
  readonly onDismissTransferPartySkipBanner: () => void;
  readonly onDismissStagingMigrationOverflowBanner: () => void;
  // S8v2.2 — selection / staging projections.
  readonly sourceSelection: ReadonlyArray<MonRef>;
  readonly destSelection: ReadonlyArray<MonRef>;
  readonly transferSelection: ReadonlyArray<number>;
  readonly stagedSlots: ReadonlyArray<StagedSlot | null>;
  readonly stagedSourceRefs: ReadonlyArray<MonRef>;
  /** monRefKey → transfer slot index for source-side staged refs.
   *  Drives the `→ T<n>` corner badge on source tiles. */
  readonly stagedSourceTransferSlot: ReadonlyMap<string, number>;
  /** Per AMEND-S8v2.2-7 — `null` (NOT empty Map) when no occupied slot
   *  has a placement matching the current dest cart, so downstream
   *  consumers can `if (previewedPlacements)` short-circuit. */
  readonly previewedPlacements: ReadonlyMap<number, PreviewedPlacement> | null;
  readonly transferBoxFullBanner: { skipped: number } | null;
  readonly transferPlacementBanner: { unplaced: number } | null;
  readonly transferConvertSkipBanner: { skipped: number } | null;
  readonly transferPartySkipBanner: { skipped: number } | null;
  readonly stagingMigrationOverflowBanner: { dropped: number } | null;
  readonly multiTabBanner: boolean;
}

export function renderWorkbench(props: WorkbenchProps): HTMLElement {
  const wrap = el('div', { class: 'workbench' });

  const leftLabel = props.leftRole === 'source' ? 'SOURCE' : 'DESTINATION';
  const oppositeLabel = props.leftRole === 'source' ? 'DESTINATION' : 'SOURCE';

  const leftPane = el('div', { class: 'wb-pane wb-pane-left' });
  leftPane.append(el('div', { class: 'wb-pane-label' }, leftLabel));
  leftPane.append(renderLeftPane(props));
  leftPane.append(renderLeftActions(oppositeLabel, props));
  wrap.append(leftPane);

  // Trading pipe chrome — pixel-art Game Boy Color + Game Boy Advance
  // console sprites with the link cable arching between them. LEFT
  // console = GBC in source role, GBA in dest role (the source pane
  // takes a Gen 1/2 cart; the dest pane takes a Gen 3 cart). RIGHT
  // console always GBA (temp box is Gen 3 storage). Sprites by
  // AloneAgainstPixels (DeviantArt) — see
  // web/public/sprites/consoles/SOURCE.md for attribution.
  wrap.append(renderTradingPipe(props));

  // RIGHT pane (always Temp Box). S8v2.2: populated when staging
  // store has occupied slots; empty wallpaper grid otherwise.
  const rightPane = el('div', { class: 'wb-pane wb-pane-right' });
  // S8v2.2 — banners stack above the TRANSFER BOX label per §3 / Risk #2.
  rightPane.append(renderTransferBoxBanners(props));
  rightPane.append(el('div', { class: 'wb-pane-label' }, 'TRANSFER BOX'));
  rightPane.append(renderTransferBox(props));
  rightPane.append(renderRightActions(props));
  wrap.append(rightPane);

  // AMEND-S8v2.1-11 — cart-read progress is a MODAL OVERLAY (theme-picker
  // pattern), not an inline card. Mounted to document.body so it floats
  // above the entire workbench with a navy backdrop. Only the loading
  // belonging to the CURRENT role surfaces (avoids cross-role progress
  // confusion when SWITCH happens mid-read).
  //
  // Teardown runs UNCONDITIONALLY on every render so the modal goes
  // away when cartReadProgress clears (success / failure / role-switch
  // away). Without this, a stuck modal lingers in document.body across
  // renders because the teardown was previously gated behind
  // `if (activeCartLoading)` — so once the loading state transitioned
  // to null, the function was never called to clean up.
  for (const node of Array.from(document.body.querySelectorAll('.cart-loading-overlay'))) {
    node.remove();
  }
  const activeCartLoading =
    props.leftRole === 'source' ? props.sourceCartLoading : props.destCartLoading;
  if (activeCartLoading) {
    appendCartLoadingModal(props.leftRole, activeCartLoading);
  }

  // Same modal pattern for load-error states — was previously rendered
  // inline in the LEFT pane (between gen 2 box rows, looked broken).
  // Now floats above the workbench so the box stays visually intact
  // beneath the modal backdrop.
  for (const node of Array.from(document.body.querySelectorAll('.cart-error-overlay'))) {
    node.remove();
  }
  const activeError = props.leftRole === 'source' ? props.sourceError : props.destError;
  if (activeError) {
    appendErrorModal(props.leftRole, activeError, props);
  }

  return wrap;
}

/**
 * LEFT pane interior — branches on role × loaded-status. Empty / loading-
 * SAV-parse / error sub-states ALL share the same outer chrome
 * (`renderEmptyGen2Box` for source, `renderEmptyGen3Box` for dest); only
 * the floating overlay swaps. Loaded sub-state replaces the box visual
 * with the populated browser.
 *
 * AMEND-S8v2.1-11: cart-read progress does NOT render an inline card —
 * it's a modal mounted by `renderWorkbench` instead. The empty box stays
 * visible underneath the modal backdrop.
 */
function renderLeftPane(props: WorkbenchProps): HTMLElement {
  const pane = el('div', { class: 'wb-pane-box-host' });

  if (props.leftRole === 'source') {
    if (props.sourceLoaded) {
      pane.append(renderLoadedSourceLeft(props.sourceLoaded, props));
      return pane;
    }
    // empty / loading-sav-parse / error all share the empty Gen 2 chrome
    pane.append(renderEmptyGen2Box());
    if (props.sourceSavParsing) {
      pane.append(renderSavParsingOverlay(props.sourceSavParsing, 'source'));
    } else if (!props.sourceCartLoading && !props.sourceError) {
      // Cart loading + errors render as MODALS (mounted on document.body
      // by renderWorkbench). Suppress the CTA overlay while either is
      // in flight so the user can't kick off a second load.
      pane.append(renderEmptyPaneCtas(props));
    }
    return pane;
  }

  // destination role
  if (props.destLoaded) {
    pane.append(renderLoadedDestLeft(props.destLoaded, props));
    return pane;
  }
  pane.append(renderEmptyGen3Box());
  if (props.destSavParsing) {
    pane.append(renderSavParsingOverlay(props.destSavParsing, 'destination'));
  } else if (!props.destCartLoading && !props.destError) {
    pane.append(renderEmptyPaneCtas(props));
  }
  return pane;
}

/**
 * Loaded source LEFT pane — the existing `boxBrowser` embedded INSIDE the
 * `.gen2-box-wrap` chrome (per AMEND-S8v2.1-6, via the `embedded` prop
 * that strips the dialog frame) so the loaded-state visual frame matches
 * the empty-state visual frame.
 *
 * Per C2: entries come from `entriesForBox` (handles party / currentBox
 * pseudo-boxes correctly); never inline `.boxes[boxIndex - 1]`.
 *
 * Per C4: `onCursorMove` stays wired to `cursor_move` even though
 * selection is S8v2.2 — keeps the cursor state-driven.
 */
function renderLoadedSourceLeft(view: SourceLoadedView, props: WorkbenchProps): HTMLElement {
  const wrap = el('div', { class: 'gen2-box-wrap' });
  const entries = entriesForBox(view.save, view.boxIndex);
  wrap.append(
    boxBrowser({
      save: view.save,
      boxIndex: view.boxIndex,
      cursor: view.cursor,
      entries,
      onCursorMove: (drow, dcol) => props.onSourceCursorMove(drow, dcol),
      onBoxChange: (delta) => props.onSourceBoxChange(delta),
      // S8v2.2 — modKeys are always supplied by the boxBrowser tile
      // click. The workbench resolves the SelectModifiers contract
      // upstream of the reducer dispatch.
      onMonOpen: (ref, modKeys) =>
        props.onSourceMonClick(ref, modKeys ?? { meta: false, ctrl: false, shift: false }),
      selection: props.sourceSelection,
      stagedRefs: props.stagedSourceRefs,
      stagedTransferSlotByRefKey: props.stagedSourceTransferSlot,
      embedded: true,
    }),
  );
  return wrap;
}

/**
 * Loaded dest LEFT pane — directly append the existing `destBoxBrowser`.
 * The wallpapered grid IS the box visual; no extra wrapping frame.
 *
 * AMEND-S8v2.1-10: pass through `boxIndex` unchanged. Do NOT pre-mount
 * any other box's grid (14 boxes × 30 slots = 420 DOM tiles).
 *
 * Per C4: `onCursorMove` stays wired even though selection is S8v2.2.
 * Per 6.10: `onSlotClick` is the only true no-op for v2.1.
 */
function renderLoadedDestLeft(view: DestLoadedView, props: WorkbenchProps): HTMLElement {
  // S8v2.2 — strip the `transferBoxIdx` field from the previewed map
  // before handing it to the dest box browser; it only needs species
  // + nickname for the ghost render.
  let previewedForBrowser:
    | ReadonlyMap<number, { speciesId: number; nicknameDisplay: string }>
    | undefined;
  if (props.previewedPlacements) {
    const m = new Map<number, { speciesId: number; nicknameDisplay: string }>();
    for (const [k, v] of props.previewedPlacements) {
      m.set(k, { speciesId: v.speciesId, nicknameDisplay: v.nicknameDisplay });
    }
    previewedForBrowser = m;
  }
  return destBoxBrowser({
    save: view.save,
    boxIndex: view.boxIndex,
    cursor: view.cursor,
    onCursorMove: (drow, dcol) => props.onDestCursorMove(drow, dcol),
    onBoxChange: (delta) => props.onDestBoxChange(delta),
    onSlotClick: (slot, modKeys) =>
      props.onDestSlotClick(slot, modKeys ?? { meta: false, ctrl: false, shift: false }),
    selection: props.destSelection,
    ...(previewedForBrowser ? { previewedPlacements: previewedForBrowser } : {}),
  });
}

/**
 * SAV-parse overlay — text-only spinner-equivalent (no progress bar
 * because parse runs in one synchronous tick after the file read; the
 * bar would just snap from 0% to 100%). Sits in the same overlay
 * positioning as the empty CTAs so the layout doesn't jump on the
 * idle → parsing transition.
 */
function renderSavParsingOverlay(view: SavParsingView, role: LeftRole): HTMLElement {
  const overlay = el('div', { class: 'wb-loading-overlay' });
  const card = el('div', { class: 'wb-loading-card' });
  const sideLabel = role === 'source' ? 'source' : 'destination';
  card.append(
    el('div', { class: 'wb-loading-phase' }, `Parsing ${sideLabel} save…`),
    el('div', { class: 'wb-loading-meta' }, `${view.fileName} (${view.size.toLocaleString()} B)`),
  );
  overlay.append(card);
  return overlay;
}

/**
 * Error overlay — shown in-pane (NOT modal) on parse / cart-read failure.
 * Carries a "Try another file" button that dispatches the appropriate
 * clear action via `onErrorDismiss`. When raw cart bytes survived the
 * read, also surfaces a "Download raw cart dump" button (mirror of the
 * legacy `renderRawCartDumpButton`).
 *
 * Per C1 — `onErrorDismiss('source')` dispatches `reset`, which clears
 * BOTH source AND dest. That's the right call for a parse-error on
 * source (no source data to preserve), but a v2.2 follow-up should add
 * a source-only clear if the dest data ever needs to survive a source
 * parse-fail dismiss.
 */
/**
 * Load-error MODAL — mounted on document.body, floats above the
 * workbench. Mirrors `appendCartLoadingModal` (same overlay pattern,
 * same teardown contract). Caller (renderWorkbench) is responsible
 * for tearing down stale `.cart-error-overlay` nodes before calling
 * this so a stale error doesn't linger after dismiss.
 */
function appendErrorModal(role: LeftRole, view: LoadErrorView, props: WorkbenchProps): void {
  const overlay = el('div', { class: 'cart-error-overlay' });
  // Click on the backdrop (NOT inside the inner card) dismisses the
  // error. Same for ESC. Mirrors the theme picker dismiss UX.
  const dismiss = (): void => {
    props.onErrorDismiss(role);
  };
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) dismiss();
  });
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      dismiss();
      document.removeEventListener('keydown', onKey);
    }
  };
  document.addEventListener('keydown', onKey);
  const inner = el('div', { class: 'cart-error-inner' });
  inner.append(
    el(
      'div',
      { class: 'cart-error-title' },
      role === 'source' ? 'Source load failed' : 'Destination load failed',
    ),
    el('div', { class: 'cart-error-reason' }, `${view.reason}: ${view.message}`),
  );
  const retry = el(
    'button',
    { type: 'button', class: 'cart-error-retry' },
    'Try another file',
  ) as HTMLButtonElement;
  retry.addEventListener('click', () => props.onErrorDismiss(role));
  inner.append(retry);
  if (view.rawBytes && props.onDownloadRawCartDump) {
    const dump = el(
      'button',
      { type: 'button', class: 'cart-error-dump' },
      'Download raw cart dump',
    ) as HTMLButtonElement;
    dump.addEventListener('click', () => props.onDownloadRawCartDump?.(role));
    inner.append(dump);
  }
  overlay.append(inner);
  document.body.append(overlay);
}

/**
 * AMEND-S8v2.1-11 — cart-read progress as a modal overlay (mirrors
 * `.theme-picker-overlay`). Mounted on `document.body` so it floats
 * above the workbench. Re-rendered on every workbench render so any
 * stale overlay from the previous render is removed before a new one
 * is appended.
 *
 * No Cancel button (the readCart promise is uncancellable today —
 * AMEND notes that if cancel becomes available it can be wired here).
 * No backdrop / ESC dismiss (cart read is a blocking operation).
 */
function appendCartLoadingModal(role: LeftRole, view: CartLoadingView): void {
  // Caller (renderWorkbench) is responsible for tearing down stale
  // overlays — that runs unconditionally per render so the modal
  // disappears when activeCartLoading transitions to null.
  const overlay = el('div', { class: 'cart-loading-overlay' });
  const inner = el('div', { class: 'cart-loading-inner' });
  const sideLabel = role === 'source' ? 'SOURCE' : 'DESTINATION';
  inner.append(el('div', { class: 'cart-loading-phase' }, `READING ${sideLabel} CART…`));
  // Reuse the existing `cartProgress` card (which already renders the
  // `.cart-progress__bar` / `.cart-progress__fill` chrome) so the phase
  // visualization stays consistent with legacy.
  inner.append(
    cartProgress({
      label: view.label ?? '',
      bytesRead: view.bytesRead,
      bytesTotal: view.bytesTotal,
      ...(view.phase ? { phase: view.phase } : {}),
    }),
  );
  overlay.append(inner);
  // Backdrop click does NOT dismiss (cart read is in-flight). ESC does
  // NOT dismiss either. The overlay disappears automatically when the
  // next render fires after `cartReadProgress` is cleared by success
  // or failure.
  document.body.append(overlay);
}

type CableEnd = 'gbc' | 'gba';

/** Position-based variant ID for the 3×3 spritesheet — `r{row}c{col}`. */
type ConsoleVariant = `r${0 | 1 | 2}c${0 | 1 | 2}`;

const CONSOLE_VARIANTS: ReadonlyArray<ConsoleVariant> = [
  'r0c0',
  'r0c1',
  'r0c2',
  'r1c0',
  'r1c1',
  'r1c2',
  'r2c0',
  'r2c1',
  'r2c2',
];

/* Variant is keyed by SIDE + KIND, not just KIND, so the LEFT and
 * RIGHT consoles have INDEPENDENT colour selections — recolouring the
 * LEFT GBA in destination role doesn't bleed into the RIGHT GBA when
 * the user switches back to source.
 *
 * Three keys exist in practice:
 *   left:gbc   — LEFT in source role
 *   left:gba   — LEFT in destination role
 *   right:gba  — RIGHT (always Gen 3 / GBA)
 */
const STORAGE_KEY_PREFIX = 'pokeportal:consoleVariant:';
const DEFAULT_VARIANT: ConsoleVariant = 'r1c1';

type ConsoleSide = 'left' | 'right';

function variantKey(side: ConsoleSide, kind: CableEnd): string {
  return `${STORAGE_KEY_PREFIX}${side}:${kind}`;
}

function getVariant(side: ConsoleSide, kind: CableEnd): ConsoleVariant {
  try {
    const v = localStorage.getItem(variantKey(side, kind));
    if (v && (CONSOLE_VARIANTS as ReadonlyArray<string>).includes(v)) {
      return v as ConsoleVariant;
    }
  } catch {
    // localStorage may throw in private mode / disabled storage.
  }
  return DEFAULT_VARIANT;
}

function setVariant(side: ConsoleSide, kind: CableEnd, variant: ConsoleVariant): void {
  try {
    localStorage.setItem(variantKey(side, kind), variant);
  } catch {
    // Best-effort persistence; silently ignore failure.
  }
}

function variantSrc(kind: CableEnd, variant: ConsoleVariant): string {
  return `sprites/consoles/${kind}-${variant}.png`;
}

function renderTradingPipe(props: WorkbenchProps): HTMLElement {
  const leftKind: CableEnd = props.leftRole === 'source' ? 'gbc' : 'gba';
  const wrap = el('div', { class: `trading-pipe tp-left-${leftKind}` });
  // SWITCH-role button (below the LEFT pane) is the only role-swap
  // trigger — clicking the console no longer swaps roles, it opens
  // the theme picker. onSwitchRole is referenced here so future
  // callers can still pass it without the workbench complaining if
  // we re-wire role-swap to the consoles in a different way.
  void props.onSwitchRole;
  wrap.append(renderCable(leftKind, 'gba'));
  const row = el('div', { class: 'tp-console-row' });
  row.append(renderConsoleSprite(leftKind, 'left'));
  row.append(renderConsoleSprite('gba', 'right'));
  wrap.append(row);

  // COMMIT button sits between the two consoles — it's the only
  // bridge action that affects BOTH cart sides, so its visual home
  // is the trading-pipe rather than under either pane's actions.
  // S8v2.3 — counts come from the slot-addressed snapshot directly:
  //   * source role: occupied slots that haven't been source-committed
  //     yet (per PLAN criterion 11; "staged" = pending source-write).
  //   * dest role: occupied slots with a placement (per criterion 12).
  if (props.onCommit) {
    const sourceCount = countPendingSourceCommit(props.stagedSlots);
    const placedCount = countPlacements(props.stagedSlots);
    const inSource = props.leftRole === 'source';
    const count = inSource ? sourceCount : placedCount;
    const noun = inSource ? 'staged' : 'placed';
    const commitBtn = el(
      'button',
      { type: 'button', class: 'wb-commit primary tp-commit-btn' },
      `Commit ${count} ${noun}`,
    ) as HTMLButtonElement;
    commitBtn.disabled = count === 0;
    commitBtn.addEventListener('click', () => props.onCommit!());
    wrap.append(commitBtn);
  }

  return wrap;
}

function renderConsoleSprite(kind: CableEnd, side: ConsoleSide): HTMLElement {
  // Pixel-art sprite vendored under web/public/sprites/consoles/.
  // The screen pixels are transparent in the source PNG (floodfilled
  // out), so a CSS ::after pseudo-element on `.tp-console-${kind}`
  // paints an opaque white rectangle at the screen position — the
  // console reads as "powered on" without needing a separate img layer.
  const btn = el('button', {
    type: 'button',
    class: `tp-console tp-console-${side} tp-console-${kind}`,
    'aria-label': `${kind === 'gbc' ? 'Game Boy Color' : 'Game Boy Advance'} — click to change colour`,
    title: `${kind.toUpperCase()} (click to change colour)`,
  }) as HTMLButtonElement;
  const variant = getVariant(side, kind);
  const img = el('img', {
    class: 'tp-console-color',
    src: variantSrc(kind, variant),
    alt: kind === 'gbc' ? 'Game Boy Color' : 'Game Boy Advance',
  }) as HTMLImageElement;
  btn.append(img);
  btn.addEventListener('click', () => openThemePicker(side, kind, img));
  return btn;
}

/**
 * Open a modal dialog that lets the user pick which colour variant to
 * use for the given console kind. Selecting a variant updates the
 * passed-in img element in place (so the workbench doesn't need to
 * re-render) and persists to localStorage. The dialog also surfaces
 * the artist attribution since the sprites are vendored from
 * AloneAgainstPixels' DeviantArt pieces.
 */
function openThemePicker(side: ConsoleSide, kind: CableEnd, target: HTMLImageElement): void {
  const overlay = el('div', { class: 'theme-picker-overlay' });
  const inner = el('div', { class: 'theme-picker-inner' });
  const sideLabel = side === 'left' ? 'LEFT' : 'RIGHT';
  inner.append(
    el(
      'h3',
      { class: 'theme-picker-title' },
      `${sideLabel} — choose a ${kind === 'gbc' ? 'Game Boy Color' : 'Game Boy Advance'} colour`,
    ),
  );

  const current = getVariant(side, kind);
  const grid = el('div', { class: 'theme-picker-grid' });
  for (const v of CONSOLE_VARIANTS) {
    const cell = el('button', {
      type: 'button',
      class: 'theme-picker-cell' + (v === current ? ' is-selected' : ''),
      'aria-label': `Variant ${v}`,
    }) as HTMLButtonElement;
    cell.append(
      el('img', {
        src: variantSrc(kind, v),
        alt: '',
      }),
    );
    cell.addEventListener('click', () => {
      setVariant(side, kind, v);
      target.src = variantSrc(kind, v);
      close();
    });
    grid.append(cell);
  }
  inner.append(grid);

  // Source attribution — required by the sprite licence (artist
  // requested usage be linked back). Mirrors web/public/sprites/
  // consoles/SOURCE.md.
  const attribution = el('div', { class: 'theme-picker-attribution' });
  attribution.append(
    el('strong', {}, 'Sprite credits'),
    el(
      'p',
      {},
      'Pixel-art console sprites by AloneAgainstPixels (DeviantArt). Used unmodified — original 3×3 colour spritesheet cropped per variant.',
    ),
  );
  const linksWrap = el('div', { class: 'theme-picker-links' });
  const gbcLink = el(
    'a',
    {
      href: 'https://www.deviantart.com/aloneagainstpixels/art/Gameboy-Color-Pixel-art-387395853',
      target: '_blank',
      rel: 'noopener noreferrer',
    },
    'GBC sheet',
  ) as HTMLAnchorElement;
  const gbaLink = el(
    'a',
    {
      href: 'https://www.deviantart.com/aloneagainstpixels/art/Gameboy-Advance-Pixel-Art-388212537',
      target: '_blank',
      rel: 'noopener noreferrer',
    },
    'GBA sheet',
  ) as HTMLAnchorElement;
  linksWrap.append(gbcLink, document.createTextNode(' · '), gbaLink);
  attribution.append(linksWrap);
  inner.append(attribution);

  const closeBtn = el(
    'button',
    {
      type: 'button',
      class: 'theme-picker-close',
    },
    'Close',
  ) as HTMLButtonElement;
  closeBtn.addEventListener('click', () => close());
  inner.append(closeBtn);

  overlay.append(inner);

  function close(): void {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') close();
  }
  // Backdrop click closes (but click inside .theme-picker-inner doesn't
  // bubble up as overlay click thanks to the contains check).
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
}

/**
 * Cable width = horizontal distance from LEFT sprite center to RIGHT
 * sprite center. Slot widths are sprite-tight (60 for GBC, 140 for
 * GBA) and the gap between slots is fixed at 50px (kept in sync with
 * `.tp-console-row` `gap` in style.css).
 */
function cableWidthFor(leftKind: CableEnd, rightKind: CableEnd): number {
  const halfSlot = (k: CableEnd): number => (k === 'gbc' ? 30 : 70);
  return halfSlot(leftKind) + 50 + halfSlot(rightKind);
}

function renderCable(leftKind: CableEnd, rightKind: CableEnd): SVGElement {
  // Inline-SVG link cable. Wider than the visible gap so its endpoints
  // overlap the top of each console sprite — the cable visually
  // "plugs into" the consoles instead of floating between them. Two-
  // tone stroke (dark outline + slightly lighter inner) gives the
  // cable a faint 3D plastic look.
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  const w = cableWidthFor(leftKind, rightKind);
  svg.setAttribute('viewBox', `0 0 ${w} 70`);
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', '70');
  svg.setAttribute('class', 'tp-cable-svg');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const dark = 'var(--gbc-border-outer, #303030)';
  const inner = '#5a5a5a';
  // Cubic Bezier: endpoints at SVG bottom (y=70) so the cable plugs
  // into the console tops; control points directly ABOVE each
  // endpoint at y=0 so the curve departs each endpoint near-vertically
  // and arches high across the middle — visually the cable goes UP
  // out of each console, peaks in the middle, then drops back DOWN.
  // Looks like a real link cable hanging between two consoles.
  const d = `M 0,70 C 0,0 ${w},0 ${w},70`;
  // Outer dark stroke — the cable's outline.
  const outer = document.createElementNS(NS, 'path');
  outer.setAttribute('d', d);
  outer.setAttribute('stroke', dark);
  outer.setAttribute('stroke-width', '6');
  outer.setAttribute('stroke-linecap', 'round');
  outer.setAttribute('fill', 'none');
  svg.append(outer);
  // Inner lighter stroke — the highlight for the 3D plastic look.
  const innerPath = document.createElementNS(NS, 'path');
  innerPath.setAttribute('d', d);
  innerPath.setAttribute('stroke', inner);
  innerPath.setAttribute('stroke-width', '2.5');
  innerPath.setAttribute('stroke-linecap', 'round');
  innerPath.setAttribute('fill', 'none');
  svg.append(innerPath);
  // Plug connectors at each cable endpoint — drawn AFTER the cable so
  // they cover the raw rounded cable ends. Left plug matches the LEFT
  // console kind (GBC = gray DMG-style, GBA = translucent purple).
  // Right plug is always GBA-style since the temp box (right pane) is
  // always Gen 3.
  svg.append(makePlug(NS, leftKind, 0, 70));
  svg.append(makePlug(NS, rightKind, w, 70));
  return svg;
}

function makePlug(NS: string, kind: CableEnd, cx: number, cy: number): SVGElement {
  // Connector body sits centered on the cable endpoint (cx, cy) and
  // extends downward into the console area — so the cable visually
  // emerges from the top of the plug, and the plug sits on the
  // console's link port. GBC plug is wider gray plastic (the classic
  // DMG-style connector); GBA plug is narrower translucent-purple
  // (matching the GBA's purple aesthetic).
  const g = document.createElementNS(NS, 'g');
  const isGbc = kind === 'gbc';
  const halfW = isGbc ? 9 : 7;
  // Plug body sits ABOVE the cable endpoint (which coincides with the
  // console top), with only the dark pin contacts dipping below the
  // endpoint into the console's link port. The cable enters the plug
  // from above and terminates inside the plug body.
  const top = cy - 14;
  const bottom = cy + 1;
  const fill = isGbc ? '#9a9a9a' : '#6e5ca8';
  const highlight = isGbc ? '#cfcfcf' : '#a896d4';
  const body = document.createElementNS(NS, 'rect');
  body.setAttribute('x', String(cx - halfW));
  body.setAttribute('y', String(top));
  body.setAttribute('width', String(halfW * 2));
  body.setAttribute('height', String(bottom - top));
  body.setAttribute('rx', '1.5');
  body.setAttribute('fill', fill);
  body.setAttribute('stroke', '#303030');
  body.setAttribute('stroke-width', '1.5');
  g.append(body);
  // Highlight stripe near the top — gives the plug a 3D plastic look.
  const hl = document.createElementNS(NS, 'rect');
  hl.setAttribute('x', String(cx - halfW + 2));
  hl.setAttribute('y', String(top + 2));
  hl.setAttribute('width', String(halfW * 2 - 4));
  hl.setAttribute('height', '2');
  hl.setAttribute('fill', highlight);
  g.append(hl);
  // Pin contacts — small dark rect at the bottom of the plug,
  // representing the metal contacts that plug into the console port.
  const pins = document.createElementNS(NS, 'rect');
  pins.setAttribute('x', String(cx - halfW + 2));
  pins.setAttribute('y', String(bottom - 3));
  pins.setAttribute('width', String(halfW * 2 - 4));
  pins.setAttribute('height', '2');
  pins.setAttribute('fill', '#1a1a1a');
  g.append(pins);
  return g as SVGElement;
}

/**
 * Floating CTA overlay for the empty LEFT pane — Load Cart / Load SAV
 * buttons centered on top of the gen-aware box visual. AMEND-S8v2.1-9:
 * the file input is recreated every render and `.value` is reset after
 * the change handler so the user can pick the SAME file twice in a row
 * (browsers dedupe identical-name `change` events).
 */
function renderEmptyPaneCtas(props: WorkbenchProps): HTMLElement {
  const ctas = el('div', { class: 'wb-empty-cta-overlay' });
  const loadCartBtn = el(
    'button',
    { type: 'button', class: 'wb-empty-cta wb-load-cart' },
    'Load Cart',
  ) as HTMLButtonElement;
  loadCartBtn.addEventListener('click', () => props.onLoadCart(props.leftRole));
  ctas.append(loadCartBtn);
  const loadSavLabel = el(
    'label',
    { class: 'wb-empty-cta wb-load-sav' },
    'Load SAV',
  ) as HTMLLabelElement;
  const fileInput = el('input', { type: 'file', accept: '.sav' }) as HTMLInputElement;
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (f) props.onLoadSav(props.leftRole, f);
    fileInput.value = '';
  });
  loadSavLabel.append(fileInput);
  ctas.append(loadSavLabel);
  return ctas;
}

/**
 * Empty Gen 2 PC box visual — Gen 1/2-style minimal: just the framed
 * white interior + border (the GSC dialog chrome). No "BOX 1" header,
 * no pokeball glyphs. The CTA buttons (Load Cart / Load SAV) sit on
 * top via the absolutely-positioned overlay so the box reads as a
 * "blank panel waiting for input" until a save loads.
 */
function renderEmptyGen2Box(): HTMLElement {
  const wrap = el('div', { class: 'gen2-box-wrap gen2-box-wrap--blank' });
  return wrap;
}

/**
 * Empty Gen 3 PC box (6 cols × 5 rows = 30 slots, with the in-game
 * "FOREST" wallpaper — wallpaper id 0, RS family). Used as the LEFT
 * pane container in destination role (when empty).
 */
function renderEmptyGen3Box(): HTMLElement {
  const wpUrl = 'sprites/wallpapers/rs/01.png';
  const grid = el('div', {
    class: 'box-grid dest-box-grid gen3-empty-box-grid',
    style: `background-image: linear-gradient(rgba(248,248,248,0.55), rgba(248,248,248,0.55)), url(${wpUrl});`,
  });
  for (let i = 0; i < 30; i++) {
    const tile = el('div', { class: 'box-tile dest-box-tile is-empty' });
    tile.append(el('span', { class: 'empty-marker' }, '·'));
    grid.append(tile);
  }
  return grid;
}

/**
 * S8v2.2 — RIGHT pane TRANSFER BOX render. Iterates 30 slot positions
 * and renders the staged mon at its `slot.idx` position (NOT in append
 * order — placements are slot-addressed). In source role the tiles
 * are read-only; in destination role the tiles wire to
 * `onTransferTileClick` for the v2 selection model.
 *
 * Per AMEND-S8v2.2-8: the rendered sprite is the POST-CONVERSION
 * species (`slot.speciesId`) — for Gen 1/2 source mons whose
 * `convert()` mapped to a different Gen 3 ndex, the transfer box
 * shows the destination-side form. (Documented in `StagedSlot.speciesId`'s jsdoc.)
 */
function renderTransferBox(props: WorkbenchProps): HTMLElement {
  const wpUrl = 'sprites/wallpapers/rs/01.png';
  const grid = el('div', {
    class: 'box-grid dest-box-grid gen3-empty-box-grid transfer-box-grid',
    style: `background-image: linear-gradient(rgba(248,248,248,0.55), rgba(248,248,248,0.55)), url(${wpUrl});`,
  });
  const selectionSet = new Set(props.transferSelection);
  for (let i = 0; i < 30; i++) {
    const slot = props.stagedSlots[i] ?? null;
    const isSelected = selectionSet.has(i);
    const isPlaced = slot !== null && slot.placement !== null;
    // S8v2.3 / AMEND-S8v2.3-4 — once the source-side commit lands, drop
    // the dashed-gold ghost (CSS rule is gated on `:not(.is-source-
    // committed)`). The tile keeps `.is-occupied` so layout / sprite
    // rendering stay identical; only the ghost outline + 60% opacity
    // switch off.
    const isSourceCommitted = slot !== null && slot.sourceCommitted === true;
    const tile = el('div', {
      class:
        'box-tile dest-box-tile' +
        (slot ? ' is-occupied' : ' is-empty') +
        (isSelected ? ' is-selected' : '') +
        (isPlaced ? ' is-placed' : '') +
        (isSourceCommitted ? ' is-source-committed' : ''),
      'data-slot': String(i),
    });
    if (slot) {
      tile.append(spriteImg(slot.speciesId, 'party-gen3', slot.nicknameDisplay));
      if (slot.placement) {
        // Small `→ B<n>/S<k>` badge in the corner so the user can see
        // at a glance which staged mons are queued for commit.
        tile.append(
          el(
            'span',
            { class: 'transfer-tile-placed-badge' },
            `→ B${slot.placement.destBoxIndex + 1}/S${String(slot.placement.destSlot + 1).padStart(2, '0')}`,
          ),
        );
      }
      // Click on a staged transfer-box tile in EITHER role: opens the
      // mon stat screen modal. Modifier keys (cmd/shift) still flow
      // through for dest-role multi-select; plain click in source role
      // is purely a stat view.
      tile.addEventListener('click', (ev: MouseEvent) => {
        props.onTransferTileClick(i, {
          meta: ev.metaKey,
          ctrl: ev.ctrlKey,
          shift: ev.shiftKey,
        });
      });
    } else {
      tile.append(el('span', { class: 'empty-marker' }, '·'));
    }
    grid.append(tile);
  }
  return grid;
}

/**
 * S8v2.2 — banner stack rendered ABOVE the TRANSFER BOX label.
 * Includes (in DOM order, top-to-bottom):
 *   1. multi-tab banner (no dismiss — sticks for the session)
 *   2. staging-migration overflow (AMEND-S8v2.2-9, dismissible)
 *   3. transfer-box-full (capacity overflow; dismissible)
 *   4. transfer placement (dest-box overflow; dismissible)
 *   5. transfer convert-skip (un-convertible mons; dismissible)
 */
function renderTransferBoxBanners(props: WorkbenchProps): HTMLElement {
  const wrap = el('div', { class: 'transfer-box-banners' });
  if (props.multiTabBanner) {
    wrap.append(
      el(
        'div',
        { class: 'card multi-tab-banner' },
        'Another tab has the staging box open. Changes here may overwrite that tab’s session.',
      ),
    );
  }
  if (props.stagingMigrationOverflowBanner) {
    wrap.append(
      bannerCard(
        'transfer-box-banner staging-migration-overflow-banner',
        `Staging session had ${props.stagingMigrationOverflowBanner.dropped} mons; only the first 30 were preserved. Restore from backup if you need the others.`,
        () => props.onDismissStagingMigrationOverflowBanner(),
      ),
    );
  }
  if (props.transferBoxFullBanner) {
    const k = props.transferBoxFullBanner.skipped;
    wrap.append(
      bannerCard(
        'transfer-box-banner transfer-box-full-banner',
        `Transfer box full — skipped ${k} mon${k === 1 ? '' : 's'}. Clear or commit some staged mons before adding more.`,
        () => props.onDismissTransferBoxFullBanner(),
      ),
    );
  }
  if (props.transferPlacementBanner) {
    const k = props.transferPlacementBanner.unplaced;
    wrap.append(
      bannerCard(
        'transfer-box-banner transfer-placement-banner',
        `Couldn't place ${k} mon${k === 1 ? '' : 's'} — destination box ran out of empty slots. Pick a different destination box and try again.`,
        () => props.onDismissTransferPlacementBanner(),
      ),
    );
  }
  if (props.transferConvertSkipBanner) {
    const k = props.transferConvertSkipBanner.skipped;
    wrap.append(
      bannerCard(
        'transfer-box-banner transfer-convert-skip-banner',
        `Skipped ${k} mon${k === 1 ? '' : 's'}: not eligible for transfer.`,
        () => props.onDismissTransferConvertSkipBanner(),
      ),
    );
  }
  if (props.transferPartySkipBanner) {
    const k = props.transferPartySkipBanner.skipped;
    wrap.append(
      bannerCard(
        'transfer-box-banner transfer-party-skip-banner',
        `Skipped ${k} party mon${k === 1 ? '' : 's'} — only box-stored mons can transfer. Move them into a PC box first.`,
        () => props.onDismissTransferPartySkipBanner(),
      ),
    );
  }
  return wrap;
}

function bannerCard(cls: string, text: string, onDismiss: () => void): HTMLElement {
  const card = el('div', { class: `card ${cls}` });
  card.append(el('span', { class: 'transfer-box-banner-text' }, text));
  const btn = el(
    'button',
    { type: 'button', class: 'transfer-box-banner-dismiss' },
    'Dismiss',
  ) as HTMLButtonElement;
  btn.addEventListener('click', onDismiss);
  card.append(btn);
  return card;
}

function countPlacements(slots: ReadonlyArray<StagedSlot | null>): number {
  let n = 0;
  for (const s of slots) {
    if (s !== null && s.placement !== null) n += 1;
  }
  return n;
}

/** S8v2.3 — count of occupied slots whose source-side commit is still
 *  pending. Drives the trading-pipe "Commit N staged" button label and
 *  the SWITCH-block predicate (per PLAN criteria 11 + 13). */
function countPendingSourceCommit(slots: ReadonlyArray<StagedSlot | null>): number {
  let n = 0;
  for (const s of slots) {
    if (s !== null && s.sourceCommitted !== true) n += 1;
  }
  return n;
}

function renderLeftActions(oppositeLabel: string, props: WorkbenchProps): HTMLElement {
  const actions = el('div', { class: 'wb-pane-actions' });
  // Block role-swap when there are uncommitted staged mons. S8v2.3 / PLAN
  // criterion 13: the predicate is `slots.some(s => s !== null &&
  // !s.sourceCommitted)` — i.e. once every staged slot has had its
  // source-side commit landed, SWITCH unblocks even if the mons are
  // still parked in the transfer box waiting for placement + dest commit.
  // (S8v2.2 used `stagedSourceRefs.length > 0` which would have stayed
  // hot through the source-committed/awaiting-place state.)
  const uncommittedSourceCount = countPendingSourceCommit(props.stagedSlots);
  const blockSwitch = props.leftRole === 'source' && uncommittedSourceCount > 0;
  const switchBtn = el(
    'button',
    {
      type: 'button',
      ...(blockSwitch
        ? {
            title: `Commit or remove ${uncommittedSourceCount} staged mon${uncommittedSourceCount === 1 ? '' : 's'} from the Transfer Box first.`,
          }
        : {}),
    },
    `SWITCH TO ${oppositeLabel}`,
  ) as HTMLButtonElement;
  switchBtn.disabled = blockSwitch;
  if (!blockSwitch) {
    switchBtn.addEventListener('click', () => props.onSwitchRole());
  }
  actions.append(switchBtn);

  // (COMMIT button moved to the trading-pipe area between the two
  // consoles — see renderTradingPipe.)
  const backupBtn = el('button', { type: 'button' }, 'Backup to SAV') as HTMLButtonElement;
  backupBtn.disabled = !props.onBackupToSav;
  if (props.onBackupToSav) backupBtn.addEventListener('click', () => props.onBackupToSav!());
  actions.append(backupBtn);
  // Reset — clears the loaded source/dest data for whichever role is
  // currently the LEFT pane. Disabled when the pane is empty (no
  // loaded data yet) so it's always a meaningful click.
  const leftRoleHasData = props.leftRole === 'source' ? !!props.sourceLoaded : !!props.destLoaded;
  const resetLeftBtn = el(
    'button',
    { type: 'button', class: 'wb-reset-btn' },
    'Reset',
  ) as HTMLButtonElement;
  resetLeftBtn.disabled = !leftRoleHasData;
  resetLeftBtn.addEventListener('click', () => props.onPaneReset(props.leftRole));
  actions.append(resetLeftBtn);
  // Source-only "Add selected mons to Transfer Box" action sits under
  // the LEFT pane while in source role — the user is moving mons FROM
  // the loaded source cart INTO the transfer box on the right.
  if (props.leftRole === 'source') {
    const addBtn = el(
      'button',
      { type: 'button', class: 'primary wb-add-to-transfer' },
      'Add selected mons to Transfer Box',
    ) as HTMLButtonElement;
    // S8v2.2 — enabled only when source loaded AND selection non-empty.
    const enabled =
      !!props.onAddSelectedToTransfer && !!props.sourceLoaded && props.sourceSelection.length > 0;
    addBtn.disabled = !enabled;
    if (props.onAddSelectedToTransfer)
      addBtn.addEventListener('click', () => props.onAddSelectedToTransfer!());
    actions.append(addBtn);
    // S8v2.2-polish — bulk-select buttons. Plain-click is no longer a
    // selection action (it opens the stat-screen modal), so explicit
    // bulk selectors are needed to gather mons without modifier-key
    // gymnastics.
    if (props.sourceLoaded && props.onSelectAllSourceBox) {
      const selectAllBtn = el(
        'button',
        { type: 'button', class: 'wb-select-all-source-box' },
        'Select all in box',
      ) as HTMLButtonElement;
      selectAllBtn.addEventListener('click', () => props.onSelectAllSourceBox!());
      actions.append(selectAllBtn);
    }
    // Select party button intentionally removed — party mons aren't
    // eligible for transfer (only box-stored mons), so a bulk-select
    // for party would only ever surface "skipped N party mons" banners.
  }
  // Destination-role bulk-select-in-box.
  if (props.leftRole === 'destination' && props.destLoaded && props.onSelectAllDestBox) {
    const selectAllBtn = el(
      'button',
      { type: 'button', class: 'wb-select-all-dest-box' },
      'Select all in box',
    ) as HTMLButtonElement;
    selectAllBtn.addEventListener('click', () => props.onSelectAllDestBox!());
    actions.append(selectAllBtn);
  }
  return actions;
}

function renderRightActions(props: WorkbenchProps): HTMLElement {
  const actions = el('div', { class: 'wb-pane-actions' });

  // S8v2.2 — Clear Transfer Box. Always present; disabled when the
  // staging store is empty.
  const occupiedCount = props.stagedSlots.reduce((acc, s) => (s !== null ? acc + 1 : acc), 0);
  const clearBtn = el(
    'button',
    { type: 'button', class: 'wb-clear-transfer-box' },
    'Clear Transfer Box',
  ) as HTMLButtonElement;
  clearBtn.disabled = occupiedCount === 0;
  clearBtn.addEventListener('click', () => props.onClearTransferBox());
  actions.append(clearBtn);

  // v2.3 — Export Transfer Box snapshot (JSON). Backup mechanism per
  // user request: download the entire staging-store contents (including
  // the per-slot Gen 1/2 sentinel-JSON pkBytes) so the user can preserve
  // their staged mons even across browser/IDB resets.
  const exportBtn = el(
    'button',
    { type: 'button', class: 'wb-export-transfer-json' },
    'Export Transfer Box (JSON)',
  ) as HTMLButtonElement;
  exportBtn.disabled = occupiedCount === 0 || !props.onExportTransferBoxJson;
  if (props.onExportTransferBoxJson)
    exportBtn.addEventListener('click', () => props.onExportTransferBoxJson!());
  actions.append(exportBtn);

  // v2.3 — Import Transfer Box JSON (debug). REPLACES current staging
  // store contents with the JSON payload. Useful for restoring a
  // backup or seeding state for testing.
  const importLabel = el(
    'label',
    { class: 'wb-import-transfer-json' },
    'Load Transfer Box (JSON)',
  ) as HTMLLabelElement;
  const importInput = el('input', {
    type: 'file',
    accept: '.json,application/json',
    style: 'display:none',
  }) as HTMLInputElement;
  importInput.addEventListener('change', () => {
    const f = importInput.files?.[0];
    if (f && props.onImportTransferBoxJson) props.onImportTransferBoxJson(f);
    importInput.value = '';
  });
  importLabel.append(importInput);
  actions.append(importLabel);

  // Select all in Transfer Box — symmetric with the source pane's
  // "Select all in box" button. Always available when there are
  // staged mons, regardless of leftRole.
  if (props.onSelectAllTransferBox) {
    const selectAllBtn = el(
      'button',
      { type: 'button', class: 'wb-select-all-transfer' },
      'Select all in Transfer',
    ) as HTMLButtonElement;
    selectAllBtn.disabled = occupiedCount === 0;
    selectAllBtn.addEventListener('click', () => props.onSelectAllTransferBox!());
    actions.append(selectAllBtn);
  }

  // "Add selected mons to Destination" sits under the RIGHT pane in
  // EITHER role — sending staged mons to the dest cart is sensible
  // regardless of which role the LEFT pane is currently presenting,
  // as long as a destination cart has been loaded at some point.
  const addBtn = el(
    'button',
    { type: 'button', class: 'primary wb-add-to-destination' },
    'Add selected mons to Destination',
  ) as HTMLButtonElement;
  const enabled =
    !!props.onAddSelectedToDestination && !!props.destLoaded && props.transferSelection.length > 0;
  addBtn.disabled = !enabled;
  if (props.onAddSelectedToDestination)
    addBtn.addEventListener('click', () => props.onAddSelectedToDestination!());
  actions.append(addBtn);

  return actions;
}
