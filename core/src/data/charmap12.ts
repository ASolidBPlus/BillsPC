import raw from './raw/charmap12.json' with { type: 'json' };

/** Gen 1/2 string terminator byte. */
export const GEN12_TERMINATOR = 0x50;

const ENTRIES: ReadonlyArray<readonly [number, string]> = Object.entries(
  raw as Record<string, string>,
).map(([k, v]) => [Number(k), v] as const);

/** byte -> Unicode string. 0x50 (terminator) intentionally absent. */
export const CHARMAP12_TO_UNICODE: ReadonlyMap<number, string> = new Map(
  ENTRIES.filter(([b]) => b !== GEN12_TERMINATOR),
);

/**
 * Decode a Gen 1/2 byte sequence. Stops at 0x50 (terminator) or end of bytes.
 * Unmapped bytes become U+FFFD so that the downstream Gen 3 encoder can
 * substitute a '?'.
 */
export function decodeGen12(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (b === GEN12_TERMINATOR) break;
    const ch = CHARMAP12_TO_UNICODE.get(b);
    out += ch ?? '�';
  }
  return out;
}
