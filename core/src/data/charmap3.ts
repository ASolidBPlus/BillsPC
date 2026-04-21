import raw from './raw/charmap3.json' with { type: 'json' };

/** Gen 3 string terminator byte. */
export const GEN3_TERMINATOR = 0xff;

/**
 * PKHeX G3_U: 0xAC is '?'. PLAN text mentions 0x59 but that is wrong for the
 * International Gen 3 charmap — this constant is the one to use.
 */
export const GEN3_QUESTION_MARK = 0xac;

const ENTRIES: ReadonlyArray<readonly [number, string]> = Object.entries(
  raw as Record<string, string>,
).map(([k, v]) => [Number(k), v] as const);

export const GEN3_BYTE_TO_UNICODE: ReadonlyMap<number, string> = new Map(ENTRIES);

/** Unicode codepoint (single char) -> Gen 3 byte. */
export const UNICODE_TO_CHARMAP3: ReadonlyMap<string, number> = new Map(
  // Reverse; if two bytes map to the same char (shouldn't in this subset), the last wins.
  ENTRIES.map(([b, ch]) => [ch, b] as const),
);

/**
 * Encode a Unicode string to a Gen 3 byte sequence. Unmapped characters
 * become GEN3_QUESTION_MARK. The returned buffer is NOT terminated —
 * callers append 0xFF.
 */
export function encodeGen3(text: string, fallback: number = GEN3_QUESTION_MARK): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const b = UNICODE_TO_CHARMAP3.get(ch);
    out.push(b ?? fallback);
  }
  return Uint8Array.from(out);
}
