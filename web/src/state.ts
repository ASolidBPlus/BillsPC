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
 * All states are immutable; reducer returns a new object on every action.
 * Render diffs by identity.
 */
import type { SaveContents, SaveError } from '@pokeportal/core';

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

export type AppState =
  | { kind: 'idle' }
  | { kind: 'parsing'; fileName: string; size: number }
  | { kind: 'parse_error'; fileName: string; error: SaveError }
  | {
      kind: 'loaded';
      fileName: string;
      save: SaveContents;
      results: ReadonlyMap<string, ConvertResult>;
      // S5 fields (per PLAN §5):
      boxIndex: number;
      cursor: Cursor;
      openMon: MonRef | null;
    };

export type Action =
  | { type: 'file_selected'; file: { name: string; size: number } }
  | { type: 'file_parsed'; save: SaveContents; fileName: string }
  | { type: 'file_failed'; error: SaveError; fileName: string }
  | { type: 'convert_done'; ref: MonRef; result: ConvertResult }
  | { type: 'reset' }
  // S5 actions:
  | { type: 'cursor_move'; drow: -1 | 0 | 1; dcol: -1 | 0 | 1 }
  | { type: 'box_change'; delta: -1 | 1 }
  | { type: 'mon_open'; ref: MonRef }
  | { type: 'mon_close' };

export const INITIAL_STATE: AppState = { kind: 'idle' };

const ROWS = 5;
const COLS = 4;

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
    default:
      return state;
  }
}
