/**
 * Internal re-exports for tests. NOT part of the public API — `index.ts`
 * does not re-export from here. Test files import this path directly.
 */
export { sha256, sha256Hex } from './primitives/sha256.js';
export { hash, hashConcat } from './primitives/hash.js';
export { seedRng } from './primitives/rng.js';
export { personalitySeed } from './primitives/personalitySeed.js';

export { checkRefused } from './fields/eligibility.js';
export { deriveIVs } from './fields/ivs.js';
export type { IVs, IVResult } from './fields/ivs.js';
export { deriveEVs, EV_STAT_ORDER } from './fields/evs.js';
export type { EVs, EVResult } from './fields/evs.js';
export { deriveNature, NEUTRAL_NATURES, NATURE_NAMES } from './fields/nature.js';
export { searchPID } from './fields/pid.js';
export { deriveSID } from './fields/otSid.js';
export { MET_DATA } from './fields/met.js';
export { preserveMoves } from './fields/moves.js';
export { mapHeldItem } from './fields/heldItem.js';
export { preservePokerus } from './fields/pokerus.js';
export { deriveFriendship } from './fields/friendship.js';
export { preserveLevelExp } from './fields/levelExp.js';
export { abilitySlot } from './fields/ability.js';
export { convertNickname, convertOTName } from './fields/strings.js';
export { CONTEST_ZEROS, RIBBONS_EMPTY, MARKINGS_ZERO } from './fields/zeros.js';
export { gen3Gender, gen3ShinyCheck } from './fields/shinyGender.js';
export { UNOWN_SPECIES_GEN2_ID, unownLetterFromPid, gen2UnownLetter } from './fields/unown.js';
export { isWildMethodSpread, WILD_METHODS_CHECKED } from './fields/pidMethods.js';

export { hpDv, gen2Shiny, gen2Gender } from './types/source.js';

export { REFUSED_SPECIES, refusalReason } from './data/refused.js';
export { getSpecies, allSpecies } from './data/species.js';
export type { SpeciesEntry } from './data/species.js';
export { EggGroup, getEggGroups } from './data/eggGroups.js';
export { getPersonal } from './data/personalInfo.js';
export type { PersonalInfo } from './data/personalInfo.js';
export { GEN12_TERMINATOR, CHARMAP12_TO_UNICODE, decodeGen12 } from './data/charmap12.js';
export {
  GEN3_TERMINATOR,
  GEN3_QUESTION_MARK,
  GEN3_BYTE_TO_UNICODE,
  UNICODE_TO_CHARMAP3,
  encodeGen3,
} from './data/charmap3.js';
