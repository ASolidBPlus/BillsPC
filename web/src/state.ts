/**
 * Pure reducer + action types for the upload UI.
 *
 * All states are immutable; reducer returns a new object on every
 * action. Render diffs by identity.
 *
 * Per PLAN_EVAL A14, the reducer surfaces empty-party and all-refused
 * cases via flags on the loaded state — the renderer reads them directly
 * without needing to recompute from results.
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

export type AppState =
  | { kind: 'idle' }
  | { kind: 'parsing'; fileName: string; size: number }
  | { kind: 'parse_error'; fileName: string; error: SaveError }
  | {
      kind: 'loaded';
      fileName: string;
      save: SaveContents;
      results: ReadonlyMap<string, ConvertResult>;
      expandedBoxes: ReadonlySet<number>; // for stored boxes (0..n-1)
      currentBoxExpanded: boolean;
    };

export type Action =
  | { type: 'file_selected'; file: { name: string; size: number } }
  | { type: 'file_parsed'; save: SaveContents; fileName: string }
  | { type: 'file_failed'; error: SaveError; fileName: string }
  | { type: 'convert_done'; ref: MonRef; result: ConvertResult }
  | { type: 'box_toggled'; boxIndex: number }
  | { type: 'current_box_toggled' }
  | { type: 'reset' };

export const INITIAL_STATE: AppState = { kind: 'idle' };

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
        expandedBoxes: new Set(),
        currentBoxExpanded: false,
      };
    case 'file_failed':
      return { kind: 'parse_error', fileName: action.fileName, error: action.error };
    case 'convert_done': {
      if (state.kind !== 'loaded') return state;
      const next = new Map(state.results);
      next.set(monRefKey(action.ref), action.result);
      return { ...state, results: next };
    }
    case 'box_toggled': {
      if (state.kind !== 'loaded') return state;
      const next = new Set(state.expandedBoxes);
      if (next.has(action.boxIndex)) next.delete(action.boxIndex);
      else next.add(action.boxIndex);
      return { ...state, expandedBoxes: next };
    }
    case 'current_box_toggled': {
      if (state.kind !== 'loaded') return state;
      return { ...state, currentBoxExpanded: !state.currentBoxExpanded };
    }
    default:
      return state;
  }
}
