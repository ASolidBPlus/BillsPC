/**
 * Gen 2 ↔ Gen 3 move-ID passthrough.
 *
 * HANDOFF §4.9: "Gen 3 was a superset — no Gen 2 move needs remapping in practice."
 * S2 will add a sanity check that iterates Gen 2 move IDs and confirms Gen 3 has
 * the same ID → same move. For S1 this is a no-op identity map.
 *
 * TODO(S2): confirm with PKHeX `MoveName.cs` and add a regression assert.
 */
export function mapMoveGen2ToGen3(gen2MoveId: number): number {
  return gen2MoveId;
}
