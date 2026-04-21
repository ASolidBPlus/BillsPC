/**
 * Gen 3 substructure shuffle.
 *
 * The 48-byte encrypted block holds four 12-byte substructures (Growth,
 * Attacks, EVs/Condition, Misc). Their wire order depends on `PID % 24`
 * — one of 24 lexicographic permutations of {G, A, E, M}.
 *
 * Spec: PKHeX `PKX.cs` `blockPosition` / `blockPositionInvert` and
 * Bulbapedia "Pokemon data substructures (Generation III)" §Data Order.
 *
 * The 24-row table below is the **independent transcription** confirmed
 * in PLAN_EVAL §"Independent PID%24 permutation table". Every row is one
 * of the 24 lexicographic permutations of the letters G, A, E, M; the
 * six-row groupings begin at indexes 0/6/12/18 (each lead-letter band).
 *
 * `PERMUTATION[k]` is the wire order: `[slot0, slot1, slot2, slot3]`
 * where each entry names which substructure occupies that slot. So
 * `shuffleSubstructures` walks `PERMUTATION[k]` and concatenates the
 * named substructure into the wire block; `unshuffleSubstructures`
 * inverts by index lookup.
 *
 * **Hazards**:
 *  - JS `%` on a signed-int32 `PID` can return negative; always
 *    `(pid >>> 0) % 24`. The helper `pidPermIndex` enforces this.
 *  - Don't alias PERMUTATION and INVERSE — they are distinct lookups.
 *    `PERMUTATION` answers "what's in wire slot i?", `INVERSE` answers
 *    "where in the wire is substructure X?".
 */

import { u32 } from './leBytes.js';

export type SubstructTag = 'G' | 'A' | 'E' | 'M';

export type PermutationRow = readonly [SubstructTag, SubstructTag, SubstructTag, SubstructTag];

/** 24 rows × 4 wire slots → tag of the substructure at that slot. */
export const PERMUTATION: ReadonlyArray<PermutationRow> = [
  /*  0 */ ['G', 'A', 'E', 'M'],
  /*  1 */ ['G', 'A', 'M', 'E'],
  /*  2 */ ['G', 'E', 'A', 'M'],
  /*  3 */ ['G', 'E', 'M', 'A'],
  /*  4 */ ['G', 'M', 'A', 'E'],
  /*  5 */ ['G', 'M', 'E', 'A'],
  /*  6 */ ['A', 'G', 'E', 'M'],
  /*  7 */ ['A', 'G', 'M', 'E'],
  /*  8 */ ['A', 'E', 'G', 'M'],
  /*  9 */ ['A', 'E', 'M', 'G'],
  /* 10 */ ['A', 'M', 'G', 'E'],
  /* 11 */ ['A', 'M', 'E', 'G'],
  /* 12 */ ['E', 'G', 'A', 'M'],
  /* 13 */ ['E', 'G', 'M', 'A'],
  /* 14 */ ['E', 'A', 'G', 'M'],
  /* 15 */ ['E', 'A', 'M', 'G'],
  /* 16 */ ['E', 'M', 'G', 'A'],
  /* 17 */ ['E', 'M', 'A', 'G'],
  /* 18 */ ['M', 'G', 'A', 'E'],
  /* 19 */ ['M', 'G', 'E', 'A'],
  /* 20 */ ['M', 'A', 'G', 'E'],
  /* 21 */ ['M', 'A', 'E', 'G'],
  /* 22 */ ['M', 'E', 'G', 'A'],
  /* 23 */ ['M', 'E', 'A', 'G'],
];

/**
 * `INVERSE[k][slot]` = wire slot index that holds substructure `slot`,
 * where `slot` is the 0..3 index of {G, A, E, M}.
 *
 * Equivalently: PLAN §4.2's `INVERSE[r][i]` returns "where in the wire
 * is the substructure tagged `i`?" — used by the unshuffler to gather
 * substructures back from a flat 48-byte buffer.
 */
const TAG_INDEX: Readonly<Record<SubstructTag, number>> = { G: 0, A: 1, E: 2, M: 3 };

export const INVERSE: ReadonlyArray<readonly [number, number, number, number]> = PERMUTATION.map(
  (row) => {
    const inv: [number, number, number, number] = [-1, -1, -1, -1];
    for (let slot = 0; slot < 4; slot++) {
      inv[TAG_INDEX[row[slot]!]] = slot;
    }
    return inv;
  },
);

/** `(pid >>> 0) % 24`, guarded against signed-int negative-mod hazard. */
export function pidPermIndex(pid: number): number {
  return u32(pid) % 24;
}

/**
 * Shuffle four 12-byte substructures into a 48-byte wire block per
 * `PID % 24`. Each input must be exactly 12 bytes.
 */
export function shuffleSubstructures(
  g: Uint8Array,
  a: Uint8Array,
  e: Uint8Array,
  m: Uint8Array,
  pid: number,
): Uint8Array {
  for (const [name, buf] of [
    ['G', g],
    ['A', a],
    ['E', e],
    ['M', m],
  ] as const) {
    if (buf.length !== 12) {
      throw new RangeError(`substructure ${name} must be 12 bytes, got ${buf.length}`);
    }
  }
  const order = PERMUTATION[pidPermIndex(pid)]!;
  const out = new Uint8Array(48);
  const subs: Readonly<Record<SubstructTag, Uint8Array>> = { G: g, A: a, E: e, M: m };
  for (let slot = 0; slot < 4; slot++) {
    out.set(subs[order[slot]!], slot * 12);
  }
  return out;
}

/**
 * Inverse of `shuffleSubstructures`. Returns `[g, a, e, m]` extracted
 * from a 48-byte wire-ordered (decrypted) block per `PID % 24`.
 */
export function unshuffleSubstructures(
  wire: Uint8Array,
  pid: number,
): readonly [Uint8Array, Uint8Array, Uint8Array, Uint8Array] {
  if (wire.length !== 48) {
    throw new RangeError(`unshuffleSubstructures expected 48 bytes, got ${wire.length}`);
  }
  const inv = INVERSE[pidPermIndex(pid)]!;
  const slice = (s: number): Uint8Array => wire.slice(s * 12, s * 12 + 12);
  return [
    slice(inv[0]!), // G's wire slot
    slice(inv[1]!), // A's wire slot
    slice(inv[2]!), // E's wire slot
    slice(inv[3]!), // M's wire slot
  ];
}
