/**
 * Length triage and emulator header/trailer stripping.
 *
 * Per PLAN_EVAL A2: the Crystal demo file is 32768 + 48 bytes (an
 * emulator save-state metadata trailer). Some emulators prepend a
 * header instead of appending. We accept either, strip explicitly,
 * and surface a `warnings` entry so the data path is never silent.
 *
 * Returns the canonical 32768-byte SRAM image with a list of warnings.
 * Returns `null` if the buffer is too short or the trailer/header
 * cannot be reconciled to a 32 KB SRAM image.
 *
 * The probe parameter is a callback that returns true if a candidate
 * 32K window looks like a parseable Gen 1/2 SRAM (used to pick head vs
 * tail strip). This keeps the format-detection probes inside
 * `format.ts` instead of duplicating offset literals here.
 */

export const SRAM_BYTES = 32768 as const;
export const MAX_SAVE_BYTES = 131072 as const;
export const ACCEPTED_TRAILER_LENGTHS = [16, 32, 48, 64, 96, 128, 256, 512] as const;

export interface TriageOk {
  readonly kind: 'ok';
  readonly bytes: Uint8Array; // exactly 32768 bytes
  readonly warnings: readonly string[];
}

export interface TriageFail {
  readonly kind: 'fail';
  readonly reason: 'TOO_SHORT' | 'UNRECOGNIZED_LENGTH';
  readonly message: string;
}

export type TriageResult = TriageOk | TriageFail;

/**
 * Probe callback: receives a candidate 32K SRAM window and returns
 * true if it looks structurally valid. Used to pick head- vs tail-
 * stripped variants when the input has an emulator wrapper.
 */
export type TriageProbe = (sram: Uint8Array) => boolean;

export function triage(bytes: Uint8Array, probe: TriageProbe): TriageResult {
  if (bytes.length < SRAM_BYTES) {
    return {
      kind: 'fail',
      reason: 'TOO_SHORT',
      message: `save buffer is ${bytes.length} bytes; need at least ${SRAM_BYTES}`,
    };
  }

  if (bytes.length === SRAM_BYTES) {
    return { kind: 'ok', bytes, warnings: [] };
  }

  if (bytes.length > MAX_SAVE_BYTES) {
    return {
      kind: 'fail',
      reason: 'UNRECOGNIZED_LENGTH',
      message: `save buffer ${bytes.length} bytes exceeds maximum supported ${MAX_SAVE_BYTES}`,
    };
  }

  const delta = bytes.length - SRAM_BYTES;

  // Common emulator dump padding: 64 KB or 128 KB raw chip dumps. The first
  // 32 KB is the active SRAM image. Try the head-aligned 32K first.
  if (delta === SRAM_BYTES || delta === SRAM_BYTES * 3) {
    const head = bytes.subarray(0, SRAM_BYTES);
    if (probe(head)) {
      return {
        kind: 'ok',
        bytes: new Uint8Array(head),
        warnings: [`padded_dump_truncated_to_${SRAM_BYTES}`],
      };
    }
  }

  // Trailer/header strip for explicit small trailer sizes.
  if ((ACCEPTED_TRAILER_LENGTHS as readonly number[]).includes(delta)) {
    const tailStripped = bytes.subarray(0, SRAM_BYTES);
    if (probe(tailStripped)) {
      return {
        kind: 'ok',
        bytes: new Uint8Array(tailStripped),
        warnings: [`emulator_trailer_stripped(${delta})`],
      };
    }
    const headStripped = bytes.subarray(delta, delta + SRAM_BYTES);
    if (probe(headStripped)) {
      return {
        kind: 'ok',
        bytes: new Uint8Array(headStripped),
        warnings: [`emulator_header_stripped(${delta})`],
      };
    }
  }

  return {
    kind: 'fail',
    reason: 'UNRECOGNIZED_LENGTH',
    message: `save buffer ${bytes.length} bytes; expected 32768 or 32768 + {${ACCEPTED_TRAILER_LENGTHS.join(',')}} for emulator trailers`,
  };
}
