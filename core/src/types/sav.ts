/**
 * Sprint 3a: Gen 1/2 save reader types.
 *
 * The save reader is a strict input adapter for the existing
 * `Gen12Pokemon` model. Parser output flows directly into
 * `convert()` from S1 and `packBoxed()` from S2.
 *
 * Public API uses a discriminated `kind` tag for `SaveError` so callers
 * can use the `isSaveError` type guard to fork on success/failure
 * without try/catch.
 *
 * GS and Yellow detection are wired into `parseSave` for Sprint 3a but
 * return `UNSUPPORTED_VARIANT` because we have no fixtures to test
 * against. The format-detection enum still includes `RBY-YELLOW` and
 * `GS` so the public type is forward-compatible with S3b+.
 */
import type { Gen12Pokemon } from './source.js';

export type SaveFormat = 'RBY-RED' | 'RBY-BLUE' | 'RBY-YELLOW' | 'GS' | 'CRYSTAL';

export interface TrainerInfo {
  readonly name: string;
  readonly nameBytes: Uint8Array;
  readonly tid: number;
  readonly playTime?: { hours: number; minutes: number; seconds: number };
  readonly money?: number;
  readonly gender?: 0 | 1;
}

/**
 * Parsed save contents.
 *
 * `boxes.length` is a stable invariant per format (12 for Gen 1, 14 for
 * Gen 2). Boxes that fail structural validation are returned as empty
 * arrays AND a `box_${i}_corrupt:...` warning is appended.
 *
 * When `currentBoxIndex !== undefined`, `boxes[currentBoxIndex]` may be
 * stale; `currentBox` is the live working copy. Display layer chooses
 * which to render — the parser does NOT merge the two.
 */
export interface SaveContents {
  readonly format: SaveFormat;
  readonly trainer: TrainerInfo;
  readonly party: readonly Gen12Pokemon[];
  readonly boxes: readonly (readonly Gen12Pokemon[])[];
  readonly currentBox?: readonly Gen12Pokemon[];
  readonly currentBoxIndex?: number;
  readonly warnings: readonly string[];
}

export type SaveErrorReason =
  | 'UNRECOGNIZED_FORMAT'
  | 'UNSUPPORTED_VARIANT'
  | 'TOO_SHORT'
  | 'CORRUPTED'
  | 'BAD_CHECKSUM'
  | 'TRUNCATED_PARTY';

export interface SaveError {
  readonly kind: 'save_error';
  readonly reason: SaveErrorReason;
  readonly message: string;
}

export function isSaveError(x: SaveContents | SaveError): x is SaveError {
  return (x as { kind?: string }).kind === 'save_error';
}

/**
 * S3b will satisfy this interface with a Web Serial GBxCart adapter so the
 * UI controller can swap input sources without changing the reducer.
 */
export interface SaveSource {
  read(): Promise<Uint8Array>;
  readonly label: string;
}
