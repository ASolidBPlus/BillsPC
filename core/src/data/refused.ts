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
 * Note on Unown (201) and babies (172 Pichu, 173 Cleffa, 174 Igglybuff, 175 Togepi,
 * 236 Tyrogue, 238 Smoochum, 239 Elekid, 240 Magby):
 *
 * Unown is intentionally NOT refused despite being Undiscovered in Gen 2 PersonalInfo.
 * HANDOFF §4.6 explicitly specifies a PID search for Unown; PLAN_EVAL A4 binds that
 * §4.6 wins over §4.0's over-inclusive Undiscovered blanket. Do not "fix" the
 * inconsistency by adding Unown to the refused set.
 *
 * Babies ARE refused per the literal §4.0 spec (PLAN_EVAL A11). A future sprint may
 * revisit, but S1 honours the spec as written. Do not remove babies from this set.
 */
export function refusalReason(gen2Id: number): { reason: RefusalReason; name: string } | null {
  return REASONS.get(gen2Id) ?? null;
}
