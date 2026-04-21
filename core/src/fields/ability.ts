/**
 * §4.14: ability slot is always 0 (the species' first ability). Hidden
 * Abilities did not exist in Gen 3 and would break legality at every step
 * downstream — never use slot 1 here.
 */
export function abilitySlot(): 0 {
  return 0;
}
