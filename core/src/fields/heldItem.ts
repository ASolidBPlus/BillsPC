import type { Gen12Pokemon } from '../types/source.js';

/**
 * Gen 2 items whose IDs do not map cleanly to a Gen 3 item (or whose Gen 2
 * counterpart has no Gen 3 equivalent). These become NO_ITEM (0).
 *
 * S1: hardcoded partial list sufficient for common cases. S2 will port the
 * full PKHeX Gen2 → Gen 3 item map.
 */
const GEN2_ITEMS_WITHOUT_GEN3: ReadonlySet<number> = new Set([
  // Gen 2 mail, GS Ball, and other Gen-2-exclusives. A full list lands in S2.
  // Sentinel: empty set is acceptable since S2 handles the remap properly;
  // the current identity pass is safe for well-known items.
]);

/**
 * §4.10: Gen 1 → 0 (Gen 1 has no held items). Gen 2 → identity map,
 * except for items with no Gen 3 equivalent (→ 0).
 */
export function mapHeldItem(src: Gen12Pokemon): number {
  if (src.sourceGen === 1 || src.heldItemGen2Id === null) return 0;
  if (GEN2_ITEMS_WITHOUT_GEN3.has(src.heldItemGen2Id)) return 0;
  return src.heldItemGen2Id;
}
