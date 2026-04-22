/**
 * Regional-dex warning helper (per PLAN_EVAL A10).
 *
 * Fires when:
 *   - destination is R/S or FR/LG AND species > 251 (Hoenn species, out
 *     of Kanto+Johto range and not in either regional dex anyway), OR
 *   - destination is FR/LG AND species is in the Johto range (152..251)
 *     — those aren't in Kanto's regional dex.
 *
 * Emerald is OK at all ndex 1..386 once National Dex is unlocked, but we
 * have no way to know whether the player has the National Dex. The
 * Plan Evaluator's recommendation: warn for the strictly-impossible
 * cases only (Hoenn species into R/S; Johto species into FR/LG). Emerald
 * recipients see no warning.
 */
import type { Gen3Family } from '@pokeportal/core';

export function regionalDexWarning(destFamily: Gen3Family, speciesGen3Ndex: number): string | null {
  if (destFamily === 'EMERALD') return null;
  if (destFamily === 'RS' && speciesGen3Ndex >= 252) {
    return 'Note: this species (Hoenn ndex ≥ 252) is not in the Ruby/Sapphire regional dex. It will be hidden in-game until you obtain the National Dex on the destination cart.';
  }
  if (destFamily === 'FRLG') {
    if (speciesGen3Ndex >= 252) {
      return 'Note: this species (Hoenn ndex ≥ 252) is not in the FireRed/LeafGreen regional dex. It will be hidden in-game until you obtain the National Dex on the destination cart.';
    }
    if (speciesGen3Ndex >= 152 && speciesGen3Ndex <= 251) {
      return 'Note: this Johto species is not in the FireRed/LeafGreen Kanto regional dex. It will be hidden in-game until you obtain the National Dex on the destination cart.';
    }
  }
  return null;
}
