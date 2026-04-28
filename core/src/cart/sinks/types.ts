/**
 * Shared types for the S7b sink layer.
 *
 * The sinks themselves implement the family-agnostic `SaveSink` interface
 * (`core/src/sav/saveSink.ts`); this file holds the structured-error
 * shape that `WriteAndVerifySink` raises so the recovery dialog can
 * populate informative copy.
 */

import type { DiffEntry } from '../protocol/agbFlash.js';

export interface WriteVerifyMismatch {
  readonly expectedLength: number;
  readonly actualLength: number;
  readonly mismatchCount: number;
  /** First few mismatching offsets + their values (capped per AMEND-S7b-12). */
  readonly mismatches: readonly DiffEntry[];
  readonly firstMismatchOffset: number;
}
