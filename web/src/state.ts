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
}

export interface CartReadError {
  readonly reason: string;
  readonly message: string;
  /** Raw cart bytes if the read succeeded but parsing failed — UI can
   *  surface a "download raw dump" button so the user can binary-diff
   *  against a known-good FlashGBX dump. */
  readonly rawBytes?: Uint8Array;
  readonly rawFileName?: string;
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
  | { type: 'cart_connect_started' }
  | {
      type: 'cart_connect_progress';
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

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'reset':
      return INITIAL_STATE;
    case 'file_selected':
      return { kind: 'parsing', fileName: action.file.name, size: action.file.size };
    case 'file_parsed':
      return {
        kind: 'loaded',
        fileName: action.fileName,
        save: action.save,
        sourceBytes: action.bytes,
        results: new Map(),
        boxIndex: 0,
        cursor: { row: 0, col: 0 },
        openMon: null,
      };
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
      return { ...state, boxIndex: next, cursor: { row: 0, col: 0 } };
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
      return {
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
      };
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
      return {
        ...state,
        dest: undefined,
        destParsing: undefined,
        destParseError: undefined,
        destDownload: undefined,
      };
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
      return {
        ...state,
        dest: { ...state.dest, boxIndex: next, cursor: { row: 0, col: 0 } },
      };
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
        cartReadProgress: { bytesRead: 0, bytesTotal: 0, phase: 'connecting' },
        cartReadError: undefined,
      };
    }
    case 'cart_connect_progress': {
      const progress: CartReadProgress = {
        bytesRead: action.bytesRead,
        bytesTotal: action.bytesTotal,
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
      return next;
    }
    case 'cart_dest_connect_succeeded': {
      return {
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
      };
    }
    case 'cart_connect_failed': {
      return {
        ...state,
        cartReadProgress: undefined,
        cartReadError: {
          reason: action.reason,
          message: action.message,
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
