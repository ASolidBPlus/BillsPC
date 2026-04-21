export { getSpecies, allSpecies } from './species.js';
export type { SpeciesEntry } from './species.js';
export { EggGroup, getEggGroups } from './eggGroups.js';
export { REFUSED_SPECIES, refusalReason } from './refused.js';
export { getPersonal } from './personalInfo.js';
export type { PersonalInfo } from './personalInfo.js';
export { GEN12_TERMINATOR, CHARMAP12_TO_UNICODE, decodeGen12 } from './charmap12.js';
export {
  GEN3_TERMINATOR,
  GEN3_QUESTION_MARK,
  GEN3_BYTE_TO_UNICODE,
  UNICODE_TO_CHARMAP3,
  encodeGen3,
} from './charmap3.js';
export { mapMoveGen2ToGen3 } from './moves.js';
