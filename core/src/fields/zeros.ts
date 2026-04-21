import type { Gen3Intermediate } from '../types/target.js';

/** §4.16: contest stats / ribbons / markings all zero. */
export const CONTEST_ZEROS: Gen3Intermediate['contestStats'] = Object.freeze({
  cool: 0,
  beauty: 0,
  cute: 0,
  clever: 0,
  tough: 0,
  sheen: 0,
});

export const RIBBONS_EMPTY: Gen3Intermediate['ribbons'] = Object.freeze([]);

export const MARKINGS_ZERO = 0 as const;
