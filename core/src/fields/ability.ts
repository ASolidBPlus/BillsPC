/**
 * §4.14: derive ability slot from PID per Gen 3 mechanics — `pid & 1`
 * picks between the species's two regular abilities. For species with only
 * ONE distinct regular ability (where `ability0 === ability1` per pkhex's
 * `PersonalInfo3.HasSecondAbility = Ability1 != Ability2` rule), pin the
 * bit to 0 — pkhex's legality check rejects abilityBit=1 on a 1-ability
 * species even though the in-game lookup would silently fall back to slot 0.
 *
 * Historical note: an earlier version hardcoded slot 0 always under the
 * (incorrect) belief that slot 1 = Hidden Ability. Hidden Abilities are a
 * Gen 5 concept; in Gen 3, slot 0 and slot 1 are both regular abilities
 * for 2-ability species. Deriving from PID makes the ability deterministic
 * per source mon (since `personalitySeed` deterministically picks the PID)
 * AND — with the 1-ability guard — pkhex-legal.
 */
export function abilitySlot(pid: number, hasSecondAbility: boolean): 0 | 1 {
  if (!hasSecondAbility) return 0;
  return ((pid & 1) === 1 ? 1 : 0);
}
