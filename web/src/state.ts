/**
 * Pure reducer + action types for the pokeportal UI.
 *
 * S5 reshapes the `'loaded'` variant: the old S3a expand/collapse
 * accordion is replaced by a Gen 2-style PC box browser with a single
 * cursor and an open/closed comparison overlay. Per PLAN_EVAL S5 A9 the
 * dead `expandedBoxes` / `currentBoxExpanded` fields and their actions
 * are removed outright (no graveyard) — the only consumer was
 * `web/src/ui.ts`, which S5 rewrites.
 *
 * `boxIndex` semantics:
 *   0           → synthetic "PARTY" pseudo-box (always present)
 *   1..N        → stored boxes (boxes[0..N-1])
 *   N+1         → live "current box" pseudo-box (Gen 1/2 only; suppressed
 *                 when `save.currentBox` is undefined)
 *
 * S6a additively extends the `'loaded'` variant with optional `dest`
 * fields (a parsed Gen 3 destination save + a separate cursor for its
 * box browser). Source-side state is untouched — all S5 tests still
 * pass with `dest === undefined`.
 *
 * All states are immutable; reducer returns a new object on every action.
 * Render diffs by identity.
 */
import type { Gen3SaveContents, SaveContents, SaveError } from '@pokeportal/core';
import { slotToLegacyMon } from './cart/stagingStore.js';
import type { StagedMon, StagedSlot, StagingSessionV1 } from './cart/stagingStore.types.js';
import { STAGING_SLOT_COUNT } from './cart/stagingStore.types.js';

export interface MonRef {
  readonly bucket: 'party' | 'currentBox' | 'box';
  readonly boxIndex?: number;
  readonly slot: number;
}

export function monRefKey(r: MonRef): string {
  if (r.bucket === 'box') return `box:${r.boxIndex ?? 0}:${r.slot}`;
  return `${r.bucket}:${r.slot}`;
}

export interface ConvertOk {
  readonly ok: true;
  readonly bytes: Uint8Array;
  readonly suggestedName: string;
  readonly speciesGen2Id: number;
}
export interface ConvertFail {
  readonly ok: false;
  readonly reason: string;
  readonly message: string;
}
export type ConvertResult = ConvertOk | ConvertFail;

export interface Cursor {
  readonly row: number; // 0..4
  readonly col: number; // 0..3
}

/** S6a destination cursor: 5 rows × 6 cols = 30 slots per box. */
export interface DestCursor {
  readonly row: number; // 0..4
  readonly col: number; // 0..5
}

export interface DestState {
  readonly fileName: string;
  readonly save: Gen3SaveContents;
  readonly boxIndex: number; // 0..13
  readonly cursor: DestCursor;
}

/**
 * Pending download stored after a successful STORE.
 *
 * S6b: when both source AND destination saves were loaded, this holds a
 * ZIP buffer containing both modified .sav files (source with the
 * transferred mon deleted, destination with the mon injected). When only
 * the destination was modified (legacy S6a path), it still holds the
 * single modified .sav. The `suggestedFilename` extension distinguishes
 * (`.zip` vs `.sav`).
 */
export interface DestDownload {
  readonly bytes: Uint8Array;
  readonly suggestedFilename: string;
}

export interface DestParsing {
  readonly fileName: string;
  readonly size: number;
}

export interface DestParseError {
  readonly fileName: string;
  readonly error: SaveError;
}

/**
 * Destination-side fields. Present on EVERY top-level state — destination
 * uploads are independent of the source flow so the user can drop either
 * file first. Reducer transitions for `dest_*` actions don't gate on
 * `state.kind`; only the STORE action requires both source-loaded AND
 * dest-loaded.
 */
export interface DestSlot {
  readonly destParsing?: DestParsing;
  readonly destParseError?: DestParseError;
  readonly dest?: DestState;
  readonly destDownload?: DestDownload;
}

/** S7a — global Mode toggle (per orchestrator decision Q2). */
export type Mode = 'upload' | 'cart';

/**
 * S7a — cart-mode connection state (additive). When `mode === 'cart'`
 * AND a cart is connected, this carries the firmware variant + a
 * display-friendly device id (e.g. "GBxCart RW v1.4 PCB Firmware R26").
 */
export interface CartConnection {
  readonly variant: 'insidegadgets' | 'lesserkuma';
  readonly deviceId: string;
}

export interface CartReadProgress {
  readonly bytesRead: number;
  readonly bytesTotal: number;
  readonly phase?: 'connecting' | 'detecting' | 'reading' | 'parsing';
  /** AMEND-S8v2.1-3 — disambiguate which side the in-flight cart read
   *  belongs to. The legacy panes know their side from context; the v2
   *  workbench collapses both panes into one LEFT host so it needs an
   *  explicit tag to pick which loading overlay (if any) to surface. */
  readonly side: 'source' | 'dest';
}

export interface CartReadError {
  readonly reason: string;
  readonly message: string;
  /** Raw cart bytes if the read succeeded but parsing failed — UI can
   *  surface a "download raw dump" button so the user can binary-diff
   *  against a known-good FlashGBX dump. */
  readonly rawBytes?: Uint8Array;
  readonly rawFileName?: string;
  /** AMEND-S8v2.1-3 — same rationale as CartReadProgress.side. */
  readonly side: 'source' | 'dest';
}

/**
 * S7a — cart-side ambient state shared across all top-level kinds.
 * Mirrors `DestSlot`'s additive shape: present on every state so the
 * reducer doesn't have to fork on `kind` for cart actions.
 */
export interface CartSlot {
  readonly mode?: Mode;
  readonly cartConnection?: CartConnection;
  readonly cartReadProgress?: CartReadProgress;
  readonly cartReadError?: CartReadError;
  // S7b cart-write side (additive — none of these breaks Upload-Mode tests):
  readonly cartFlash?: CartFlashState;
  readonly staging?: StagingViewState;
  /** Recovery attempt counter for the current cart-flash failure. Per
   *  AMEND-S7b-14 / DECISION-7 capped at 3 before the dialog flips to
   *  "use FlashGBX manually" copy. */
  readonly recoveryAttempts?: number;
  /** AMEND-S7b-18 — surface "another tab claimed the staging box" banner. */
  readonly multiTabBanner?: boolean;
  /** AMEND-S7b-16 / DECISION-2 — when the destination cart's
   *  (tid, cartLabel) matches the source cart's, the connect path
   *  refuses to accept the dest read. The reducer surfaces this flag
   *  and the UI renders a hard-refuse modal (no OVERRIDE escape hatch
   *  per DECISION-2). Cleared by the user via the "OK" button or
   *  by clearing the staging session. */
  readonly sameCartRefusal?: { readonly sourceTid: number; readonly sourceLabel: string };
  /** AMEND-S8v2.1-2 — which role the v2 workbench's LEFT pane shows.
   *  Lives on state (not module-local) because the renderer must be a
   *  pure function of state — async cart-read landings can re-render
   *  while the user is in the other role and the renderer needs to
   *  consult state, not module storage. UI-only field; the reducer
   *  never branches on it beyond the toggle action. The local string
   *  literal (no import from the UI layer) keeps state.ts free of UI
   *  dependencies per AMEND-S8v2.1-5. */
  readonly v2LeftRole?: 'source' | 'destination';
  // S8v2.2 — selection state (per AMEND-S8v2.2 §2.1). Three independent
  // arrays + anchors so the LEFT-pane source-role selection, LEFT-pane
  // destination-role selection, and RIGHT-pane transfer-selection live
  // in different value spaces. All clear together on context shifts
  // (`v2_switch_role`, `*_box_change`, `*_clear`, `reset`,
  // `file_parsed`, `cart_connect_succeeded`, `staging_cleared`) via
  // `withSelectionsCleared(state)`.
  readonly v2SourceSelection?: ReadonlyArray<MonRef>;
  readonly v2SourceSelectionAnchor?: MonRef;
  readonly v2DestSelection?: ReadonlyArray<MonRef>;
  readonly v2DestSelectionAnchor?: MonRef;
  /** Slot indices 0..29 within `state.staging.slots`. */
  readonly v2TransferSelection?: ReadonlyArray<number>;
  readonly v2TransferSelectionAnchor?: number;
  /** Capacity-overflow banner — set when an Add-to-Transfer batch
   *  exceeded the 30-slot transfer-box limit; `skipped` mons were
   *  dropped from the batch. Dismissible. */
  readonly transferBoxFullBanner?: { readonly skipped: number };
  /** Placement-overflow banner — set when an Add-to-Destination batch
   *  ran out of empty dest slots; `unplaced` mons were skipped.
   *  Dismissible. */
  readonly transferPlacementBanner?: { readonly unplaced: number };
  /** Convert-skip banner — set when an Add-to-Transfer batch contained
   *  mons that `convert()` refused; `skipped` mons were filtered out.
   *  Dismissible. */
  readonly transferConvertSkipBanner?: { readonly skipped: number };
  /** Party-skip banner — set when an Add-to-Transfer batch contained
   *  party-bucket mons (only box-stored mons are eligible for transfer
   *  per user spec). `skipped` is the count filtered out. Dismissible. */
  readonly transferPartySkipBanner?: { readonly skipped: number };
  /** AMEND-S8v2.2-9 — IDB v1→v2 migration overflow banner. Set once
   *  by the controller right after `staging_loaded` if the migration
   *  dropped staged mons past the 30-slot cap. Dismissible. */
  readonly stagingMigrationOverflowBanner?: { readonly dropped: number };
}

/**
 * S7b — cart-flash sub-state (per PLAN §11.1). Lives on `AppState` as an
 * optional field, NOT a new top-level state — the cart pane keeps showing
 * its existing content while the flash overlay floats on top.
 */
export type CartFlashState =
  | { readonly kind: 'cart_flash_idle' }
  | {
      readonly kind: 'cart_flash_pending';
      readonly target: 'source' | 'destination';
      readonly planSummary: string;
    }
  | {
      readonly kind: 'cart_flash_progressing';
      readonly target: 'source' | 'destination';
      readonly phase: 'connecting' | 'detecting' | 'backup' | 'flashing' | 'verifying';
      readonly progress?: { readonly bytesWritten: number; readonly bytesTotal: number };
    }
  | {
      readonly kind: 'cart_flash_failed';
      readonly target: 'source' | 'destination';
      readonly errorReason: string;
      readonly errorMessage: string;
      readonly recoveryAvailable: {
        readonly backupFilename: string;
        readonly backupBytes: Uint8Array;
        readonly family: 'gb' | 'gbc' | 'gba';
      } | null;
    }
  | {
      readonly kind: 'cart_flash_succeeded';
      readonly target: 'source' | 'destination';
      readonly verifiedBytes: Uint8Array;
      readonly verifiedAt: string;
    }
  | {
      readonly kind: 'cart_recovery_progressing';
      readonly backupFilename: string;
      readonly progress?: { readonly bytesWritten: number; readonly bytesTotal: number };
    }
  | { readonly kind: 'cart_recovery_done' }
  | {
      readonly kind: 'cart_recovery_failed';
      readonly errorReason: string;
      readonly errorMessage: string;
      readonly attemptsExhausted: boolean;
    };

/** Per PLAN §11.2 + AMEND-S7b-15 — `staging` defaults to 'staging' subview.
 *
 * AMEND-S8v2.2-12: carries BOTH the new slot-addressed `slots`
 * (length-30 array, source-of-truth for v2.2 renderers) AND the legacy
 * `stagedMons` (derived alias, source-of-truth for `stagingPane.ts`
 * and any test that reads `state.staging.stagedMons.length`). The
 * reducer's `staging_loaded` case computes both; `staging_cleared`
 * clears both.
 */
export interface StagingViewState {
  /** v2.2 — slot-addressed snapshot. Length always 30. */
  readonly slots: ReadonlyArray<StagedSlot | null>;
  /** Deprecated — derived from `slots.filter(s => s !== null).map(slotToLegacyMon)`.
   *  Retained for legacy `stagingPane.ts` and any test that reads
   *  `state.staging.stagedMons.length`. */
  readonly stagedMons: ReadonlyArray<StagedMon>;
  readonly rightPaneSubview: 'staging' | 'destination';
  readonly sessionMetadata: StagingSessionV1['sessionMetadata'];
  /**
   * When set, the next dest-box slot click assigns this staged mon's
   * destination instead of moving the cursor. Cleared once assigned.
   * The "Place at..." button in stagingPane sets this; the dest box
   * browser's onSlotClick checks it.
   */
  readonly placingMonAt?: string | null;
}

export type AppState = DestSlot &
  CartSlot &
  (
    | { kind: 'idle' }
    | { kind: 'parsing'; fileName: string; size: number }
    | { kind: 'parse_error'; fileName: string; error: SaveError }
    | {
        kind: 'loaded';
        fileName: string;
        save: SaveContents;
        /**
         * S6b — raw SRAM bytes captured at parse time so the source-side
         * deleter can operate on the in-memory buffer without re-reading
         * the user's file. Updated in place after each STORE so chained
         * STOREs delete from the post-previous-STORE state.
         */
        sourceBytes: Uint8Array;
        results: ReadonlyMap<string, ConvertResult>;
        // S5 fields (per PLAN §5):
        boxIndex: number;
        cursor: Cursor;
        openMon: MonRef | null;
      }
  );

export type Action =
  | { type: 'file_selected'; file: { name: string; size: number } }
  | { type: 'file_parsed'; save: SaveContents; fileName: string; bytes: Uint8Array }
  | { type: 'file_failed'; error: SaveError; fileName: string }
  | { type: 'convert_done'; ref: MonRef; result: ConvertResult }
  | { type: 'reset' }
  // S5 actions:
  | { type: 'cursor_move'; drow: -1 | 0 | 1; dcol: -1 | 0 | 1 }
  | { type: 'box_change'; delta: -1 | 1 }
  | { type: 'mon_open'; ref: MonRef }
  | { type: 'mon_close' }
  // S6a actions:
  | { type: 'dest_file_selected'; file: { name: string; size: number } }
  | { type: 'dest_file_parsed'; save: Gen3SaveContents; fileName: string }
  | { type: 'dest_file_failed'; error: SaveError; fileName: string }
  | { type: 'dest_clear' }
  | { type: 'dest_cursor_move'; drow: -1 | 0 | 1; dcol: -1 | 0 | 1 }
  | { type: 'dest_box_change'; delta: -1 | 1 }
  // S7a cart-mode actions (additive — none break existing transitions):
  | { type: 'mode_changed'; mode: Mode }
  | { type: 'cart_connect_started'; side: 'source' | 'dest' }
  | {
      type: 'cart_connect_progress';
      side: 'source' | 'dest';
      bytesRead: number;
      bytesTotal: number;
      phase?: 'connecting' | 'detecting' | 'reading' | 'parsing';
    }
  | {
      type: 'cart_connect_succeeded';
      connection: CartConnection;
      save: SaveContents;
      bytes: Uint8Array;
      fileName: string;
    }
  | {
      type: 'cart_dest_connect_succeeded';
      connection: CartConnection;
      save: Gen3SaveContents;
      bytes: Uint8Array;
      fileName: string;
    }
  | {
      type: 'cart_connect_failed';
      side: 'source' | 'dest';
      reason: string;
      message: string;
      rawBytes?: Uint8Array;
      rawFileName?: string;
    }
  | { type: 'cart_disconnected' }
  | {
      type: 'store_committed';
      save: Gen3SaveContents;
      bytes: Uint8Array;
      suggestedFilename: string;
      /**
       * S6b: optional refreshed source save (the in-memory state after the
       * transferred mon was deleted from the source). When present the
       * reducer swaps it into `state.save` so subsequent STOREs see fresh
       * slot indices. When absent the source side is left untouched
       * (legacy single-save flow).
       */
      sourceSave?: SaveContents;
      sourceBytes?: Uint8Array;
    }
  // S7b cart-write side (additive — none of these cases break Upload-Mode reducers).
  | {
      type: 'staging_loaded';
      session: StagingSessionV1;
      /** AMEND-S8v2.2-12 / DECISION-S8v2.2-7 — optional new-shape
       *  payload. When present the reducer uses it directly; when
       *  absent (legacy callers / synthetic test actions) the reducer
       *  derives `slots` from `session.stagedMons`. */
      slots?: ReadonlyArray<StagedSlot | null>;
    }
  | { type: 'staging_cleared' }
  | { type: 'right_pane_subview'; subview: 'staging' | 'destination' }
  | { type: 'multi_tab_claim_received' }
  | { type: 'place_mon_pending'; stagedAt: string }
  | { type: 'place_mon_assigned' }
  | {
      type: 'commit_started';
      target: 'source' | 'destination';
      planSummary: string;
    }
  | {
      type: 'flash_phase';
      target: 'source' | 'destination';
      phase: 'connecting' | 'detecting' | 'backup' | 'flashing' | 'verifying';
    }
  | {
      type: 'flash_progress';
      target: 'source' | 'destination';
      bytesWritten: number;
      bytesTotal: number;
    }
  | {
      type: 'flash_succeeded';
      target: 'source' | 'destination';
      verifiedBytes: Uint8Array;
    }
  | {
      type: 'flash_failed';
      target: 'source' | 'destination';
      errorReason: string;
      errorMessage: string;
      recoveryAvailable: {
        backupFilename: string;
        backupBytes: Uint8Array;
        family: 'gb' | 'gbc' | 'gba';
      } | null;
    }
  | {
      type: 'recovery_started';
      backupFilename: string;
    }
  | {
      type: 'recovery_progress';
      bytesWritten: number;
      bytesTotal: number;
    }
  | { type: 'recovery_done' }
  | {
      type: 'recovery_failed';
      errorReason: string;
      errorMessage: string;
    }
  | { type: 'cart_flash_dismissed' }
  // AMEND-S7b-16 / DECISION-2 — same-cart hard-refuse on dest connect.
  | { type: 'same_cart_refused'; sourceTid: number; sourceLabel: string }
  | { type: 'same_cart_refusal_dismissed' }
  // S8v2.1 — v2 workbench LEFT pane role toggle (AMEND-S8v2.1-2).
  | { type: 'v2_switch_role' }
  // S8v2.1 — source-only clear (mirrors `dest_clear`; preserves dest
  // and v2LeftRole / cart state).
  | { type: 'source_clear' }
  // S8v2.2 — multi-select interaction model (per AMEND-S8v2.2 §2.1).
  | {
      type: 'v2_select_toggle';
      side: 'source' | 'dest';
      ref: MonRef;
      /** 'replace' = single-click; 'add' = cmd/ctrl-click; 'range' = shift-click. */
      mode: 'replace' | 'add' | 'range';
      /** Resolved (ref → slot index) inside the current visible box.
       *  Used for range-extend math; the reducer maps the inclusive
       *  index range back to MonRefs against the entries the caller
       *  passes in `entries`. */
      slotInBox: number;
      /** All occupied refs in the current visible box, in slot-major
       *  order. Required for `mode === 'range'` so the reducer can
       *  filter the [anchor, click] index range to occupied refs only.
       *  Optional otherwise (replace/add don't need it). */
      entries?: ReadonlyArray<{ ref: MonRef; slotInBox: number }>;
    }
  | { type: 'v2_select_clear'; side: 'source' | 'dest' }
  | {
      type: 'v2_transfer_select_toggle';
      idx: number;
      mode: 'replace' | 'add' | 'range';
    }
  | { type: 'v2_transfer_select_clear' }
  | { type: 'v2_transfer_box_full'; skipped: number }
  | { type: 'v2_transfer_box_full_dismiss' }
  | { type: 'v2_transfer_placement_banner'; unplaced: number }
  | { type: 'v2_transfer_placement_banner_dismiss' }
  | { type: 'v2_transfer_convert_skip'; skipped: number }
  | { type: 'v2_transfer_convert_skip_dismiss' }
  | { type: 'v2_transfer_party_skip'; skipped: number }
  | { type: 'v2_transfer_party_skip_dismiss' }
  | { type: 'staging_migration_overflow'; dropped: number }
  | { type: 'staging_migration_overflow_dismiss' }
  // S8v2.2-polish — bulk-select actions. Each replaces the relevant
  // selection array with the supplied refs. The controller is the only
  // caller; it computes the refs from the currently-visible box.
  | { type: 'v2_select_all_source_box'; refs: ReadonlyArray<MonRef> }
  | { type: 'v2_select_all_dest_box'; refs: ReadonlyArray<MonRef> }
  | { type: 'v2_select_all_transfer_box'; idxs: ReadonlyArray<number> }
  // S8v2.3 — commit actions. FIRE-ON-SUCCESS only: dispatched after the
  // underlying SAV download / cart flash actually landed. They do NOT
  // mutate the staging store directly — the v2.3 handler calls
  // `stagingStore.setSourceCommitted` / `removeAt` BEFORE dispatching,
  // and the dispatch re-derives `state.staging.slots` via the existing
  // subscribe path. The reducer cases here update the in-memory bytes
  // (per AMEND-S8v2.3-1) and clear any in-flight cart-flash overlay.
  | { type: 'v2_source_committed'; readonly slotIdxs: ReadonlyArray<number> }
  | { type: 'v2_dest_committed'; readonly slotIdxs: ReadonlyArray<number> }
  // AMEND-S8v2.3-1 — explicit bytes-refresh actions (the legacy
  // flash_succeeded reducer doesn't touch state.sourceBytes /
  // state.dest.save.bytes; v2.3 needs an explicit refresh so the
  // source-tile overlay clears after a cart commit). The handler
  // re-parses bytes BEFORE dispatch (parse failure → keep stale + log).
  | {
      type: 'v2_source_bytes_refreshed';
      readonly bytes: Uint8Array;
      readonly save: SaveContents;
    }
  | {
      type: 'v2_dest_bytes_refreshed';
      readonly bytes: Uint8Array;
      readonly save: Gen3SaveContents;
    };

export const INITIAL_STATE: AppState = { kind: 'idle' };

const ROWS = 5;
const COLS = 4;
const DEST_ROWS = 5;
const DEST_COLS = 6;
const DEST_BOX_COUNT = 14;

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/** Total selectable box count for the given save: 1 (party) + N stored + (1 if currentBox). */
function maxBoxIndex(save: SaveContents): number {
  const stored = save.boxes.length;
  const live = save.currentBox ? 1 : 0;
  return stored + live; // boxIndex 0 is party; max valid index is stored + live
}

/**
 * S8v2.2 — clear ALL three v2 selection arrays + their anchors.
 *
 * Per AMEND-S8v2.2 §2.4 / CLAR-5: applied by every action that shifts
 * the selection's value space (role switch, box change, file replace,
 * cart connect, source/dest clear, reset, staging clear). The CLAR-5
 * reminder: anchors must clear too — otherwise a stale anchor leaks
 * across context shifts and shift-range computes against a since-
 * removed mon.
 */
function withSelectionsCleared<T extends AppState>(state: T): T {
  if (
    state.v2SourceSelection === undefined &&
    state.v2DestSelection === undefined &&
    state.v2TransferSelection === undefined &&
    state.v2SourceSelectionAnchor === undefined &&
    state.v2DestSelectionAnchor === undefined &&
    state.v2TransferSelectionAnchor === undefined
  ) {
    return state;
  }
  return {
    ...state,
    v2SourceSelection: undefined,
    v2SourceSelectionAnchor: undefined,
    v2DestSelection: undefined,
    v2DestSelectionAnchor: undefined,
    v2TransferSelection: undefined,
    v2TransferSelectionAnchor: undefined,
  };
}

/** Per AMEND-S8v2.2-12 — derive the legacy `stagedMons` view from the
 *  slot-addressed `slots` array. Reused by `staging_loaded` and
 *  `staging_cleared` so the legacy `stagingPane.ts` keeps reading the
 *  same shape it always did. */
function deriveStagedMons(slots: ReadonlyArray<StagedSlot | null>): ReadonlyArray<StagedMon> {
  const out: StagedMon[] = [];
  for (const s of slots) {
    if (s !== null) out.push(slotToLegacyMon(s));
  }
  return out;
}

/** Per AMEND-S8v2.2-12 / DECISION-S8v2.2-7 — derive a slots array
 *  from a legacy `StagingSessionV1` when the action carries the legacy
 *  shape only (no explicit `slots` field). The legacy session is a
 *  flat list of staged mons; we lay them out into the first N slots,
 *  truncating at 30 and padding the rest with null. */
function deriveSlotsFromLegacy(session: StagingSessionV1): ReadonlyArray<StagedSlot | null> {
  const out: Array<StagedSlot | null> = Array.from({ length: STAGING_SLOT_COUNT }, () => null);
  for (let i = 0; i < Math.min(session.stagedMons.length, STAGING_SLOT_COUNT); i++) {
    const m = session.stagedMons[i];
    if (!m) continue;
    const sourceRefKey =
      m.sourceRef.bucket === 'box'
        ? `${m.sourceCartLabel}|${m.sourceTid}|box:${m.sourceRef.boxIndex ?? 0}:${m.sourceRef.slot}`
        : `${m.sourceCartLabel}|${m.sourceTid}|${m.sourceRef.bucket}:${m.sourceRef.slot}`;
    const placement = m.destination
      ? {
          destBoxIndex: m.destination.destBoxIndex,
          destSlot: m.destination.destSlot,
          destCartLabel: m.destination.destCartLabel,
          destTid: m.destination.destTid,
          destFormat:
            m.destination.destFormat === 'firered' || m.destination.destFormat === 'leafgreen'
              ? ('frlg' as const)
              : ('rse' as const),
        }
      : null;
    out[i] = {
      idx: i,
      pkBytes: m.pkBytes,
      speciesId: m.speciesId,
      nicknameDisplay: m.nicknameDisplay,
      sourceCartLabel: m.sourceCartLabel,
      sourceTid: m.sourceTid,
      sourceFamily: m.sourceFamily,
      sourceOtName: m.sourceOtName,
      sourceRef: m.sourceRef,
      sourceRefKey,
      stagedAt: m.stagedAt,
      placement,
    };
  }
  return out;
}

/** Test/UI helper: range-select math.
 *  Given a click target at `slotInBox`, an anchor's `slotInBox`, and
 *  the entries in the current visible box (slot-major order), return
 *  the inclusive [min, max] index range mapped to MonRefs filtered to
 *  occupied entries only. Used by `v2_select_toggle` `mode === 'range'`. */
function rangeRefs(
  anchorSlot: number,
  clickSlot: number,
  entries: ReadonlyArray<{ ref: MonRef; slotInBox: number }>,
): ReadonlyArray<MonRef> {
  const lo = Math.min(anchorSlot, clickSlot);
  const hi = Math.max(anchorSlot, clickSlot);
  const out: MonRef[] = [];
  for (const e of entries) {
    if (e.slotInBox >= lo && e.slotInBox <= hi) out.push(e.ref);
  }
  return out;
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'reset':
      return INITIAL_STATE;
    case 'file_selected':
      return { kind: 'parsing', fileName: action.file.name, size: action.file.size };
    case 'file_parsed': {
      // v2.3 fix: preserve sticky cross-source fields — `staging` MUST
      // survive a source change (it's the IDB-backed durable bridge, NOT
      // tied to the current source cart). Same for `dest`, `v2LeftRole`,
      // `mode`. Mirrors the `source_clear` preservation pattern. Without
      // this, loading a new source SAV silently empties the transfer box
      // even for already-source-committed mons (data loss).
      const next: AppState = {
        kind: 'loaded',
        fileName: action.fileName,
        save: action.save,
        sourceBytes: action.bytes,
        results: new Map(),
        boxIndex: 0,
        cursor: { row: 0, col: 0 },
        openMon: null,
        ...(state.dest ? { dest: state.dest } : {}),
        ...(state.destParsing ? { destParsing: state.destParsing } : {}),
        ...(state.destParseError ? { destParseError: state.destParseError } : {}),
        ...(state.destDownload ? { destDownload: state.destDownload } : {}),
        ...(state.v2LeftRole ? { v2LeftRole: state.v2LeftRole } : {}),
        ...(state.mode ? { mode: state.mode } : {}),
        ...(state.staging ? { staging: state.staging } : {}),
        ...(state.multiTabBanner ? { multiTabBanner: state.multiTabBanner } : {}),
      };
      return withSelectionsCleared(next);
    }
    case 'file_failed':
      return { kind: 'parse_error', fileName: action.fileName, error: action.error };
    case 'convert_done': {
      if (state.kind !== 'loaded') return state;
      const next = new Map(state.results);
      next.set(monRefKey(action.ref), action.result);
      return { ...state, results: next };
    }
    case 'cursor_move': {
      if (state.kind !== 'loaded') return state;
      const row = clamp(state.cursor.row + action.drow, 0, ROWS - 1);
      const col = clamp(state.cursor.col + action.dcol, 0, COLS - 1);
      if (row === state.cursor.row && col === state.cursor.col) return state;
      return { ...state, cursor: { row, col } };
    }
    case 'box_change': {
      if (state.kind !== 'loaded') return state;
      const max = maxBoxIndex(state.save);
      const next = clamp(state.boxIndex + action.delta, 0, max);
      if (next === state.boxIndex) return state;
      // S8v2.2 — clear v2 selections on box change (selection only makes
      // sense within a single visible box per §2.4).
      return withSelectionsCleared({
        ...state,
        boxIndex: next,
        cursor: { row: 0, col: 0 },
      });
    }
    case 'mon_open': {
      if (state.kind !== 'loaded') return state;
      return { ...state, openMon: action.ref };
    }
    case 'mon_close': {
      if (state.kind !== 'loaded') return state;
      if (state.openMon === null) return state;
      return { ...state, openMon: null };
    }
    // S6a: destination flow. Independent of source — works in ANY state.
    case 'dest_file_selected': {
      return {
        ...state,
        destParsing: { fileName: action.file.name, size: action.file.size },
        destParseError: undefined,
        dest: undefined,
        destDownload: undefined,
      };
    }
    case 'dest_file_parsed': {
      return withSelectionsCleared({
        ...state,
        destParsing: undefined,
        destParseError: undefined,
        dest: {
          fileName: action.fileName,
          save: action.save,
          boxIndex: 0,
          cursor: { row: 0, col: 0 },
        },
        destDownload: undefined,
      });
    }
    case 'dest_file_failed': {
      return {
        ...state,
        destParsing: undefined,
        destParseError: { fileName: action.fileName, error: action.error },
        dest: undefined,
        destDownload: undefined,
      };
    }
    case 'dest_clear': {
      return withSelectionsCleared({
        ...state,
        dest: undefined,
        destParsing: undefined,
        destParseError: undefined,
        destDownload: undefined,
      });
    }
    // S8v2.1: source-only clear (preserves dest + v2LeftRole + cart
    // state). The legacy `reset` action wipes back to INITIAL_STATE
    // which destroys destination data too — wrong for v2's persistent
    // two-pane model.
    case 'source_clear': {
      // S8v2.2 — preserve `staging` (per edge case 3b: Reset Source
      // does NOT clear the transfer box; staging is independent of
      // source state). Also clear all v2 selections per §2.4.
      const next: AppState = {
        kind: 'idle',
        // Preserve everything that isn't source-side.
        ...(state.dest ? { dest: state.dest } : {}),
        ...(state.destParsing ? { destParsing: state.destParsing } : {}),
        ...(state.destParseError ? { destParseError: state.destParseError } : {}),
        ...(state.destDownload ? { destDownload: state.destDownload } : {}),
        ...(state.v2LeftRole ? { v2LeftRole: state.v2LeftRole } : {}),
        ...(state.mode ? { mode: state.mode } : {}),
        ...(state.cartConnection ? { cartConnection: state.cartConnection } : {}),
        ...(state.cartReadProgress && state.cartReadProgress.side === 'dest'
          ? { cartReadProgress: state.cartReadProgress }
          : {}),
        ...(state.cartReadError && state.cartReadError.side === 'dest'
          ? { cartReadError: state.cartReadError }
          : {}),
        ...(state.sameCartRefusal ? { sameCartRefusal: state.sameCartRefusal } : {}),
        // Per §2.4 + edge case 3b: staging survives a source reset.
        ...(state.staging ? { staging: state.staging } : {}),
        ...(state.multiTabBanner ? { multiTabBanner: state.multiTabBanner } : {}),
      };
      return withSelectionsCleared(next);
    }
    case 'dest_cursor_move': {
      if (!state.dest) return state;
      const row = clamp(state.dest.cursor.row + action.drow, 0, DEST_ROWS - 1);
      const col = clamp(state.dest.cursor.col + action.dcol, 0, DEST_COLS - 1);
      if (row === state.dest.cursor.row && col === state.dest.cursor.col) return state;
      return {
        ...state,
        dest: { ...state.dest, cursor: { row, col } },
      };
    }
    case 'dest_box_change': {
      if (!state.dest) return state;
      const next = clamp(state.dest.boxIndex + action.delta, 0, DEST_BOX_COUNT - 1);
      if (next === state.dest.boxIndex) return state;
      // S8v2.2 — clear v2 selections on box change (per §2.4).
      return withSelectionsCleared({
        ...state,
        dest: { ...state.dest, boxIndex: next, cursor: { row: 0, col: 0 } },
      });
    }
    case 'store_committed': {
      if (!state.dest) return state;
      const next: AppState = {
        ...state,
        dest: { ...state.dest, save: action.save },
        destDownload: { bytes: action.bytes, suggestedFilename: action.suggestedFilename },
      };
      // S6b: if the action carries a refreshed source save (post-delete),
      // swap it in. Reset the cursor and clear cached convert results
      // because the slot indices we cached against are no longer valid.
      if (action.sourceSave && action.sourceBytes && next.kind === 'loaded') {
        return {
          ...next,
          save: action.sourceSave,
          sourceBytes: action.sourceBytes,
          boxIndex: next.boxIndex,
          cursor: { row: 0, col: 0 },
          openMon: null,
          results: new Map(),
        };
      }
      return next;
    }
    // S7a cart-mode reducer cases. All ADDITIVE — none of them touch
    // the source/dest discriminator beyond what `dest_*` already does.
    case 'mode_changed': {
      if (state.mode === action.mode) return state;
      return { ...state, mode: action.mode };
    }
    case 'cart_connect_started': {
      return {
        ...state,
        cartReadProgress: {
          bytesRead: 0,
          bytesTotal: 0,
          phase: 'connecting',
          side: action.side,
        },
        cartReadError: undefined,
      };
    }
    case 'cart_connect_progress': {
      const progress: CartReadProgress = {
        bytesRead: action.bytesRead,
        bytesTotal: action.bytesTotal,
        side: action.side,
        ...(action.phase ? { phase: action.phase } : {}),
      };
      return { ...state, cartReadProgress: progress };
    }
    case 'cart_connect_succeeded': {
      // Identical-shaped landing as `file_parsed`: the rest of the UI
      // keeps treating the parsed save the same way regardless of where
      // the bytes came from.
      const next: AppState = {
        ...state,
        cartConnection: action.connection,
        cartReadProgress: undefined,
        cartReadError: undefined,
        kind: 'loaded',
        fileName: action.fileName,
        save: action.save,
        sourceBytes: action.bytes,
        results: new Map(),
        boxIndex: 0,
        cursor: { row: 0, col: 0 },
        openMon: null,
      };
      // S8v2.2 — clear any stale v2 selections from the prior loaded state.
      return withSelectionsCleared(next);
    }
    case 'cart_dest_connect_succeeded': {
      // S8v2.2 — clear any stale v2 selections from the prior dest state.
      return withSelectionsCleared({
        ...state,
        cartConnection: action.connection,
        cartReadProgress: undefined,
        cartReadError: undefined,
        dest: {
          fileName: action.fileName,
          save: action.save,
          boxIndex: 0,
          cursor: { row: 0, col: 0 },
        },
        destDownload: undefined,
      });
    }
    case 'cart_connect_failed': {
      return {
        ...state,
        cartReadProgress: undefined,
        cartReadError: {
          reason: action.reason,
          message: action.message,
          side: action.side,
          ...(action.rawBytes ? { rawBytes: action.rawBytes } : {}),
          ...(action.rawFileName ? { rawFileName: action.rawFileName } : {}),
        },
      };
    }
    case 'cart_disconnected': {
      return {
        ...state,
        cartConnection: undefined,
        cartReadProgress: undefined,
      };
    }
    // S7b cart-write reducers (additive — never touch existing state.kind).
    case 'staging_loaded': {
      // S8v2.2 — populate BOTH `slots` (v2.2 source-of-truth) AND
      // `stagedMons` (legacy alias for `stagingPane.ts`) per
      // AMEND-S8v2.2-12. The action carries `slots` directly when
      // dispatched from the v2.2 controller subscribe wire; legacy
      // callers (test fixtures, S7b paths) only carry the legacy
      // session shape, so we derive `slots` from it.
      const slots: ReadonlyArray<StagedSlot | null> =
        action.slots ?? deriveSlotsFromLegacy(action.session);
      const staging: StagingViewState = {
        slots,
        stagedMons: deriveStagedMons(slots),
        // AMEND-S7b-15: 'staging' is the always-default subview; only an
        // explicit user click on 'Destination' switches.
        rightPaneSubview: state.staging?.rightPaneSubview ?? 'staging',
        sessionMetadata: action.session.sessionMetadata,
      };
      return { ...state, staging };
    }
    case 'staging_cleared': {
      // AMEND-S8v2.2-12 — clear BOTH slots and stagedMons.
      // §2.4 — also clear all v2 selections (transfer-only suffices since
      // the source/dest selections aren't tied to staging, but
      // withSelectionsCleared clears all three for symmetry; the test
      // suite's iteration check relies on this).
      const cleared = withSelectionsCleared(state);
      return {
        ...cleared,
        staging: cleared.staging
          ? {
              ...cleared.staging,
              slots: Array.from({ length: STAGING_SLOT_COUNT }, () => null),
              stagedMons: [],
              sessionMetadata: {
                createdAt: cleared.staging.sessionMetadata.createdAt,
                lastModifiedAt: new Date().toISOString(),
              },
            }
          : undefined,
      };
    }
    case 'right_pane_subview': {
      if (!state.staging) return state;
      if (state.staging.rightPaneSubview === action.subview) return state;
      return {
        ...state,
        staging: { ...state.staging, rightPaneSubview: action.subview },
      };
    }
    case 'multi_tab_claim_received': {
      return { ...state, multiTabBanner: true };
    }
    case 'place_mon_pending': {
      if (!state.staging) return state;
      return {
        ...state,
        staging: {
          ...state.staging,
          placingMonAt: action.stagedAt,
          rightPaneSubview: 'destination',
        },
      };
    }
    case 'place_mon_assigned': {
      if (!state.staging) return state;
      return {
        ...state,
        staging: { ...state.staging, placingMonAt: null },
      };
    }
    case 'commit_started': {
      return {
        ...state,
        cartFlash: {
          kind: 'cart_flash_pending',
          target: action.target,
          planSummary: action.planSummary,
        },
        recoveryAttempts: 0,
      };
    }
    case 'flash_phase': {
      const prev = state.cartFlash;
      const progress = prev && prev.kind === 'cart_flash_progressing' ? prev.progress : undefined;
      return {
        ...state,
        cartFlash: {
          kind: 'cart_flash_progressing',
          target: action.target,
          phase: action.phase,
          ...(progress ? { progress } : {}),
        },
      };
    }
    case 'flash_progress': {
      const prev = state.cartFlash;
      if (!prev || prev.kind !== 'cart_flash_progressing') return state;
      return {
        ...state,
        cartFlash: {
          ...prev,
          progress: { bytesWritten: action.bytesWritten, bytesTotal: action.bytesTotal },
        },
      };
    }
    case 'flash_succeeded': {
      return {
        ...state,
        cartFlash: {
          kind: 'cart_flash_succeeded',
          target: action.target,
          verifiedBytes: action.verifiedBytes,
          verifiedAt: new Date().toISOString(),
        },
      };
    }
    case 'flash_failed': {
      return {
        ...state,
        cartFlash: {
          kind: 'cart_flash_failed',
          target: action.target,
          errorReason: action.errorReason,
          errorMessage: action.errorMessage,
          recoveryAvailable: action.recoveryAvailable,
        },
      };
    }
    case 'recovery_started': {
      return {
        ...state,
        cartFlash: {
          kind: 'cart_recovery_progressing',
          backupFilename: action.backupFilename,
        },
        recoveryAttempts: (state.recoveryAttempts ?? 0) + 1,
      };
    }
    case 'recovery_progress': {
      const prev = state.cartFlash;
      if (!prev || prev.kind !== 'cart_recovery_progressing') return state;
      return {
        ...state,
        cartFlash: {
          ...prev,
          progress: { bytesWritten: action.bytesWritten, bytesTotal: action.bytesTotal },
        },
      };
    }
    case 'recovery_done': {
      return {
        ...state,
        cartFlash: { kind: 'cart_recovery_done' },
      };
    }
    case 'recovery_failed': {
      const attempts = state.recoveryAttempts ?? 0;
      const exhausted = attempts >= 3; // AMEND-S7b-14 / DECISION-7
      return {
        ...state,
        cartFlash: {
          kind: 'cart_recovery_failed',
          errorReason: action.errorReason,
          errorMessage: action.errorMessage,
          attemptsExhausted: exhausted,
        },
      };
    }
    case 'cart_flash_dismissed': {
      return { ...state, cartFlash: { kind: 'cart_flash_idle' } };
    }
    // AMEND-S7b-16 / DECISION-2 — destination cart matched source cart's
    // (tid + label). Hard-refuse: surface flag for UI modal; no override.
    case 'same_cart_refused': {
      return {
        ...state,
        sameCartRefusal: {
          sourceTid: action.sourceTid,
          sourceLabel: action.sourceLabel,
        },
        // Clear any in-flight cart-read progress so the dest pane doesn't
        // show a spinner under the modal.
        cartReadProgress: undefined,
      };
    }
    case 'same_cart_refusal_dismissed': {
      if (!state.sameCartRefusal) return state;
      return { ...state, sameCartRefusal: undefined };
    }
    // S8v2.1 — toggle the v2 workbench LEFT pane role. Default-when-unset
    // is 'source' so toggling for the first time always lands on
    // 'destination' (matches the v2.0 default-source UX).
    case 'v2_switch_role': {
      const cur = state.v2LeftRole ?? 'source';
      // S8v2.2 — clear all v2 selections on role switch (per §2.4).
      return withSelectionsCleared({
        ...state,
        v2LeftRole: cur === 'source' ? 'destination' : 'source',
      });
    }
    // S8v2.2 — multi-select toggles. Selection lives on the CartSlot
    // slice so it survives `state.kind` transitions cleanly.
    case 'v2_select_toggle': {
      const cur =
        action.side === 'source' ? (state.v2SourceSelection ?? []) : (state.v2DestSelection ?? []);
      const anchor =
        action.side === 'source' ? state.v2SourceSelectionAnchor : state.v2DestSelectionAnchor;
      let nextSel: ReadonlyArray<MonRef>;
      let nextAnchor: MonRef | undefined;
      const refKey = monRefKey(action.ref);
      if (action.mode === 'replace') {
        nextSel = [action.ref];
        nextAnchor = action.ref;
      } else if (action.mode === 'add') {
        const without = cur.filter((r) => monRefKey(r) !== refKey);
        if (without.length === cur.length) {
          // Wasn't present — append.
          nextSel = [...cur, action.ref];
        } else {
          // Was present — remove (toggle).
          nextSel = without;
        }
        nextAnchor = action.ref;
      } else {
        // 'range' — needs `entries` to map [anchor, click] index range
        // to occupied refs only. Without an anchor, fall back to replace.
        if (!anchor || !action.entries) {
          nextSel = [action.ref];
          nextAnchor = action.ref;
        } else {
          // Anchor's slotInBox: scan entries for the matching ref.
          const anchorKey = monRefKey(anchor);
          let anchorSlot = action.slotInBox;
          for (const e of action.entries) {
            if (monRefKey(e.ref) === anchorKey) {
              anchorSlot = e.slotInBox;
              break;
            }
          }
          nextSel = rangeRefs(anchorSlot, action.slotInBox, action.entries);
          // Move anchor to the new click target — matches Finder/Excel.
          nextAnchor = action.ref;
        }
      }
      if (action.side === 'source') {
        return {
          ...state,
          v2SourceSelection: nextSel,
          v2SourceSelectionAnchor: nextAnchor,
        };
      }
      return {
        ...state,
        v2DestSelection: nextSel,
        v2DestSelectionAnchor: nextAnchor,
      };
    }
    case 'v2_select_clear': {
      if (action.side === 'source') {
        if (state.v2SourceSelection === undefined && state.v2SourceSelectionAnchor === undefined)
          return state;
        return {
          ...state,
          v2SourceSelection: undefined,
          v2SourceSelectionAnchor: undefined,
        };
      }
      if (state.v2DestSelection === undefined && state.v2DestSelectionAnchor === undefined)
        return state;
      return {
        ...state,
        v2DestSelection: undefined,
        v2DestSelectionAnchor: undefined,
      };
    }
    case 'v2_transfer_select_toggle': {
      const cur = state.v2TransferSelection ?? [];
      const anchor = state.v2TransferSelectionAnchor;
      const slots = state.staging?.slots ?? [];
      let nextSel: ReadonlyArray<number>;
      let nextAnchor: number | undefined;
      if (action.mode === 'replace') {
        nextSel = [action.idx];
        nextAnchor = action.idx;
      } else if (action.mode === 'add') {
        const without = cur.filter((i) => i !== action.idx);
        if (without.length === cur.length) {
          nextSel = [...cur, action.idx];
        } else {
          nextSel = without;
        }
        nextAnchor = action.idx;
      } else {
        // 'range' — inclusive [anchor, click] filtered to occupied slots.
        if (anchor === undefined) {
          nextSel = [action.idx];
          nextAnchor = action.idx;
        } else {
          const lo = Math.min(anchor, action.idx);
          const hi = Math.max(anchor, action.idx);
          const out: number[] = [];
          for (let i = lo; i <= hi; i++) {
            if (slots[i]) out.push(i);
          }
          nextSel = out;
          nextAnchor = action.idx;
        }
      }
      return {
        ...state,
        v2TransferSelection: nextSel,
        v2TransferSelectionAnchor: nextAnchor,
      };
    }
    case 'v2_transfer_select_clear': {
      if (state.v2TransferSelection === undefined && state.v2TransferSelectionAnchor === undefined)
        return state;
      return {
        ...state,
        v2TransferSelection: undefined,
        v2TransferSelectionAnchor: undefined,
      };
    }
    case 'v2_transfer_box_full':
      return { ...state, transferBoxFullBanner: { skipped: action.skipped } };
    case 'v2_transfer_box_full_dismiss':
      return { ...state, transferBoxFullBanner: undefined };
    case 'v2_transfer_placement_banner':
      return { ...state, transferPlacementBanner: { unplaced: action.unplaced } };
    case 'v2_transfer_placement_banner_dismiss':
      return { ...state, transferPlacementBanner: undefined };
    case 'v2_transfer_convert_skip':
      return { ...state, transferConvertSkipBanner: { skipped: action.skipped } };
    case 'v2_transfer_convert_skip_dismiss':
      return { ...state, transferConvertSkipBanner: undefined };
    case 'v2_transfer_party_skip':
      return { ...state, transferPartySkipBanner: { skipped: action.skipped } };
    case 'v2_transfer_party_skip_dismiss':
      return { ...state, transferPartySkipBanner: undefined };
    case 'staging_migration_overflow':
      return { ...state, stagingMigrationOverflowBanner: { dropped: action.dropped } };
    case 'staging_migration_overflow_dismiss':
      return { ...state, stagingMigrationOverflowBanner: undefined };
    // S8v2.2-polish — bulk-select replaces the relevant selection array
    // with the controller-supplied refs. Anchor is the last ref (so a
    // subsequent shift-click extends from the bottom of the bulk).
    case 'v2_select_all_source_box': {
      const last = action.refs.length > 0 ? action.refs[action.refs.length - 1] : undefined;
      return {
        ...state,
        v2SourceSelection: action.refs,
        v2SourceSelectionAnchor: last,
      };
    }
    case 'v2_select_all_dest_box': {
      const last = action.refs.length > 0 ? action.refs[action.refs.length - 1] : undefined;
      return {
        ...state,
        v2DestSelection: action.refs,
        v2DestSelectionAnchor: last,
      };
    }
    case 'v2_select_all_transfer_box': {
      const last = action.idxs.length > 0 ? action.idxs[action.idxs.length - 1] : undefined;
      return {
        ...state,
        v2TransferSelection: action.idxs,
        v2TransferSelectionAnchor: last,
      };
    }
    // S8v2.3 — commits. The IDB mutation already happened in the v2Actions
    // handler (setSourceCommitted / removeAt) and the subscribe wire will
    // refresh `state.staging.slots` on the next event. Here we just clear
    // the in-flight cart-flash overlay so the success path doesn't leave
    // a stale dialog and reset the v2 transfer selection on dest commit
    // (the slot the user selected is gone).
    case 'v2_source_committed': {
      void action.slotIdxs;
      return {
        ...state,
        cartFlash: { kind: 'cart_flash_idle' },
      };
    }
    case 'v2_dest_committed': {
      void action.slotIdxs;
      return {
        ...state,
        cartFlash: { kind: 'cart_flash_idle' },
        v2TransferSelection: undefined,
        v2TransferSelectionAnchor: undefined,
      };
    }
    // AMEND-S8v2.3-1 — explicit bytes refresh. Mirrors the cart_*_succeeded
    // landing for the source/dest cart bytes but works for both SAV and
    // cart modes (flash_succeeded only fires on cart paths). The save
    // payload is the freshly re-parsed `SaveContents` / `Gen3SaveContents`
    // — the handler did the parse before dispatching.
    case 'v2_source_bytes_refreshed': {
      if (state.kind !== 'loaded') return state;
      return {
        ...state,
        sourceBytes: action.bytes,
        save: action.save,
        // Convert results were keyed against the old save's slot layout;
        // invalidate so the next overlay-open re-converts.
        results: new Map(),
        openMon: null,
      };
    }
    case 'v2_dest_bytes_refreshed': {
      if (!state.dest) return state;
      return {
        ...state,
        dest: { ...state.dest, save: action.save },
      };
    }
    default:
      return state;
  }
}

/** Cursor 0-based to (boxIndex 0..13, slotIndex 0..29). */
export function destCursorToSlot(cursor: DestCursor): number {
  return cursor.row * DEST_COLS + cursor.col;
}

export const DEST_BOX_ROWS = DEST_ROWS;
export const DEST_BOX_COLS = DEST_COLS;
