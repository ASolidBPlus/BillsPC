import type { Gen3Intermediate } from '../types/target.js';

/** §4.8 bred-egg cover story: hatched in FireRed at Four Island. */
export const MET_DATA: Pick<
  Gen3Intermediate,
  'metLocation' | 'metLevel' | 'metGame' | 'originGame' | 'fatefulEncounter' | 'isEgg'
> = {
  metLocation: 146, // Four Island (0x92)
  // PKHeX flags hatched eggs with met_level != 0. The egg "meets" at level 0
  // (pre-hatch placeholder); the in-party current level (5) lives elsewhere.
  // HANDOFF §4.8 wrongly mandated 5 — corrected per real-PKHeX testing.
  metLevel: 0,
  metGame: 'FireRed',
  originGame: 'FireRed',
  fatefulEncounter: false,
  isEgg: false,
};
