/**
 * Discriminated union for decode failures emitted by `unpackBoxed`.
 *
 * `unpackBoxed` never throws on malformed input — it returns a typed
 * `DecodeError` that the caller can pattern-match on. The reason set is
 * fixed (closed union) for S2; S3+ may extend it for save-level decode
 * paths (see PLAN_EVAL "Interface stability" §S3 concerns).
 *
 * `UNEXPECTED_LITERAL_FIELD` is the catch-all for on-wire bytes that
 * disagree with a literally-typed `Gen3Intermediate` field — e.g. the
 * isEgg bit set, abilitySlot=1, or any of the always-zero contest/ribbon
 * fields holding a non-zero value. `offset` (when present) points at the
 * byte where the divergence was detected, measured from the start of the
 * 80-byte boxed buffer.
 */

export type DecodeErrorReason =
  | 'BAD_LENGTH'
  | 'CHECKSUM_MISMATCH'
  | 'SPECIES_OUT_OF_RANGE'
  | 'BAD_SUBSTRUCT_ORDER'
  | 'BAD_NICKNAME_BYTES'
  | 'BAD_OTNAME_BYTES'
  | 'UNEXPECTED_LITERAL_FIELD';

export interface DecodeError {
  readonly kind: 'decode-error';
  readonly reason: DecodeErrorReason;
  readonly message: string;
  readonly offset?: number;
}

export function isDecodeError(x: unknown): x is DecodeError {
  return (
    typeof x === 'object' &&
    x !== null &&
    (x as { kind?: unknown }).kind === 'decode-error' &&
    typeof (x as { reason?: unknown }).reason === 'string'
  );
}

export function makeDecodeError(
  reason: DecodeErrorReason,
  message: string,
  offset?: number,
): DecodeError {
  return offset === undefined
    ? { kind: 'decode-error', reason, message }
    : { kind: 'decode-error', reason, message, offset };
}
