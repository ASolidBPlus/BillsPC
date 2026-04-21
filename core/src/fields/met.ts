import type { Gen3Intermediate } from '../types/target.js';

/** §4.8 bred-egg cover story: hatched in FireRed at Four Island. */
export const MET_DATA: Pick<
  Gen3Intermediate,
  'metLocation' | 'metLevel' | 'metGame' | 'originGame' | 'fatefulEncounter' | 'isEgg'
> = {
  metLocation: 146, // Four Island (0x92)
  metLevel: 5,
  metGame: 'FireRed',
  originGame: 'FireRed',
  fatefulEncounter: false,
  isEgg: false,
};
