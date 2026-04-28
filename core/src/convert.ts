import type { Gen12Pokemon } from './types/source.js';
import { gen2Gender, gen2Shiny } from './types/source.js';
import type { Gen3Intermediate, ConvertMetadata } from './types/target.js';
import type { ConvertOptions } from './types/options.js';
import type { Refusal } from './types/refusal.js';
import { getSpecies } from './data/species.js';
import { getPersonal } from './data/personalInfo.js';
import { hashConcat } from './primitives/hash.js';
import { seedRng } from './primitives/rng.js';
import { personalitySeed } from './primitives/personalitySeed.js';
import { checkRefused } from './fields/eligibility.js';
import { deriveIVs } from './fields/ivs.js';
import { deriveEVs } from './fields/evs.js';
import { deriveNature } from './fields/nature.js';
import { searchPID } from './fields/pid.js';
import { deriveSID } from './fields/otSid.js';
import { MET_DATA } from './fields/met.js';
import { preserveMoves } from './fields/moves.js';
import { mapHeldItem } from './fields/heldItem.js';
import { preservePokerus } from './fields/pokerus.js';
import { deriveFriendship } from './fields/friendship.js';
import { preserveLevelExp } from './fields/levelExp.js';
import { abilitySlot } from './fields/ability.js';
import { convertNickname, convertOTName } from './fields/strings.js';
import { CONTEST_ZEROS, MARKINGS_ZERO, RIBBONS_EMPTY } from './fields/zeros.js';
import { UNOWN_SPECIES_GEN2_ID, gen2UnownLetter } from './fields/unown.js';

const DEFAULT_PRESERVE_ZERO_DV = true;
const DEFAULT_PID_WARN = 10_000;
const DEFAULT_PID_HARDCAP = 1_000_000;

export function convert(src: Gen12Pokemon, opts: ConvertOptions = {}): Gen3Intermediate | Refusal {
  // 1. Refusal pre-flight (must run before any RNG state is touched).
  const refusal = checkRefused(src.speciesGen2Id);
  if (refusal) return refusal;

  const species = getSpecies(src.speciesGen2Id)!;
  const personal = getPersonal(species.gen3DexId);

  const preserveZeroDV = opts.preserveZeroDV ?? DEFAULT_PRESERVE_ZERO_DV;
  const rngFactory = opts.rng ?? seedRng;
  const warnThreshold = opts.pidSearchWarnThreshold ?? DEFAULT_PID_WARN;
  const hardCap = opts.pidSearchHardCap ?? DEFAULT_PID_HARDCAP;

  // 2. Personality seed.
  const personality = personalitySeed(src);

  // 3. IV draws (domain tag 'iv').
  const ivSeed = hashConcat(personality, 'iv');
  const ivRng = rngFactory(ivSeed);
  const ivResult = deriveIVs(src.dvs, ivRng, { preserveZeroDV });

  // 4. Nature.
  const nature = deriveNature(src.dvs);

  // 5. EVs.
  const evResult = deriveEVs(src.statExp);

  // 6. SID, shiny, gender.
  const sid = deriveSID(src.otNameBytes, src.tid);
  const isShiny = gen2Shiny(src.dvs);
  const gender = gen2Gender(src.dvs, personal.genderRatio);

  // 7. PID search.
  const isUnown = src.speciesGen2Id === UNOWN_SPECIES_GEN2_ID;
  const unownLetter = isUnown ? gen2UnownLetter(src.dvs) : null;
  const pidSeed = hashConcat(personality, 'pid');
  const pidResult = searchPID({
    seed: pidSeed,
    nature,
    targetGender: gender,
    genderRatioByte: personal.genderRatio,
    isShiny,
    tid: src.tid,
    sid,
    ivs: ivResult.ivs,
    isUnown,
    unownLetter,
    warnThreshold,
    hardCap,
  });

  // 8. String fields, item, friendship, level/exp.
  const otName = convertOTName(src.otNameBytes);
  const nickname = convertNickname(src.nicknameBytes);
  const friendship = deriveFriendship(src, personal);
  const heldItem = mapHeldItem(src);
  const pokerus = preservePokerus(src);
  const moveSet = preserveMoves(src);
  const { level, exp } = preserveLevelExp(src);

  const meta: ConvertMetadata = {
    pidSearchIterations: pidResult.iterations,
    evScalingApplied: evResult.scalingApplied,
    evRemainderDistributed: evResult.remainderDistributed,
    zeroDvOverridesApplied: ivResult.zeroDvOverridesApplied,
    unownLetterConstrained: isUnown,
    warnings: pidResult.warnings,
  };

  return {
    species: species.gen3DexId,
    nickname,
    otName,
    otGender: src.otGender ?? 0,
    tid: src.tid,
    sid,
    pid: pidResult.pid,
    ivs: ivResult.ivs,
    evs: evResult.evs,
    nature,
    abilitySlot: abilitySlot(pidResult.pid, personal.ability0 !== personal.ability1),
    moves: moveSet.moves,
    pp: moveSet.pp,
    ppUps: moveSet.ppUps,
    heldItem,
    friendship,
    exp,
    level,
    pokerus,
    contestStats: CONTEST_ZEROS,
    ribbons: RIBBONS_EMPTY,
    markings: MARKINGS_ZERO,
    metLocation: MET_DATA.metLocation,
    metLevel: MET_DATA.metLevel,
    metGame: MET_DATA.metGame,
    originGame: MET_DATA.originGame,
    fatefulEncounter: MET_DATA.fatefulEncounter,
    isEgg: MET_DATA.isEgg,
    language: src.language,
    _meta: meta,
  };
}
