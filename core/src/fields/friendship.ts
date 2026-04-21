import type { Gen12Pokemon } from '../types/source.js';
import type { PersonalInfo } from '../data/personalInfo.js';

/**
 * §4.12: preserve source friendship when available; else species base from
 * PersonalInfo (Gen 1 sources always take this path).
 */
export function deriveFriendship(src: Gen12Pokemon, personal: PersonalInfo): number {
  if (src.friendship === null) return personal.baseFriendship;
  return src.friendship & 0xff;
}
