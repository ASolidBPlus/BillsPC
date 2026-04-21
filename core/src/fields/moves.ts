import type { Gen12Pokemon } from '../types/source.js';
import { mapMoveGen2ToGen3 } from '../data/moves.js';

export interface MoveSet {
  readonly moves: readonly [number, number, number, number];
  readonly pp: readonly [number, number, number, number];
  readonly ppUps: readonly [number, number, number, number];
}

/**
 * §4.9: moves/PP/PP-Ups pass through verbatim. Gen 1 sources get
 * `ppUps = [0,0,0,0]` (Gen 1 has no PP-Ups concept).
 * HANDOFF §4.9 notes "none do in practice" — no Gen 2 move is missing
 * from Gen 3. TODO(S2): sanity-check at build time.
 */
export function preserveMoves(src: Gen12Pokemon): MoveSet {
  const m = src.moves;
  const moves: [number, number, number, number] = [
    mapMoveGen2ToGen3(m[0]),
    mapMoveGen2ToGen3(m[1]),
    mapMoveGen2ToGen3(m[2]),
    mapMoveGen2ToGen3(m[3]),
  ];
  const ppUps: readonly [number, number, number, number] =
    src.sourceGen === 1 ? [0, 0, 0, 0] : src.ppUps;
  return {
    moves,
    pp: src.pp,
    ppUps,
  };
}
