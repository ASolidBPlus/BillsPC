import raw from './raw/refused.json' with { type: 'json' };
import type { RefusalReason } from '../types/refusal.js';

interface RawEntry {
  readonly gen2Id: number;
  readonly name: string;
  readonly reason: RefusalReason;
}

const ENTRIES: readonly RawEntry[] = raw as readonly RawEntry[];

export const REFUSED_SPECIES: ReadonlySet<number> = new Set(ENTRIES.map((e) => e.gen2Id));

const REASONS: ReadonlyMap<number, { reason: RefusalReason; name: string }> = new Map(
  ENTRIES.map((e) => [e.gen2Id, { reason: e.reason, name: e.name }] as const),
);

/**
 * Note on Unown (201) and babies:
 *
 * - Unown is intentionally NOT refused despite being Undiscovered in Gen 2 PersonalInfo.
 *   HANDOFF §4.6 explicitly specifies a PID search for Unown; §4.6 wins over §4.0's
 *   over-inclusive Undiscovered blanket. Do not "fix" the inconsistency by adding
 *   Unown to the refused set.
 *
 * - Babies (Pichu/Cleffa/Igglybuff/Togepi/Tyrogue/Smoochum/Elekid/Magby) are NOT
 *   refused. HANDOFF §4.0's "unbreedable pre-evos" framing was wrong: babies CAN be
 *   the offspring of breeding (Pikachu × Ditto → Pichu egg → Pichu, all in Gen 3
 *   FRLG). The bred-egg origin metadata only requires the species to be a valid
 *   egg-result, not a valid breeding parent. Do not re-add babies to this set.
 *
 * - Ditto IS refused (Ditto × Ditto produces no egg; no plausible "hatched egg → Ditto"
 *   path).
 */
export function refusalReason(gen2Id: number): { reason: RefusalReason; name: string } | null {
  return REASONS.get(gen2Id) ?? null;
}
