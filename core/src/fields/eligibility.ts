import { getSpecies } from '../data/species.js';
import { refusalReason } from '../data/refused.js';
import type { Refusal } from '../types/refusal.js';

/**
 * §4.0 pre-flight: refuse species that cannot be hatched from an egg, plus
 * UNKNOWN_SPECIES for anything outside the 1..251 range.
 *
 * Runs BEFORE any RNG or hash work so that refused species do not advance
 * any deterministic state.
 */
export function checkRefused(gen2Id: number): Refusal | null {
  const species = getSpecies(gen2Id);
  if (!species) {
    return {
      kind: 'refusal',
      reason: 'UNKNOWN_SPECIES',
      speciesGen2Id: gen2Id,
      speciesName: '(unknown)',
      message: `Species #${gen2Id} is not a recognised Gen 1/2 Pokemon; conversion refused.`,
    };
  }

  const r = refusalReason(gen2Id);
  if (r) {
    return {
      kind: 'refusal',
      reason: r.reason,
      speciesGen2Id: gen2Id,
      speciesName: r.name,
      message: `${r.name} (#${gen2Id}) cannot be hatched from an egg; conversion refused.`,
    };
  }

  return null;
}
