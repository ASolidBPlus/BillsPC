/**
 * Sanitise a `<species>-<nickname>-<TID>.pk3` filename. Per PLAN §6.5
 * and PLAN_EVAL test gap §"Filename sanitisation": Gen 1 default
 * nicknames are uppercase species names — keep those verbatim, only
 * substitute `'no-nickname'` when nickname is empty after sanitisation.
 */
const SAFE_CHARS = /[^A-Za-z0-9_.-]/g;
const RUN_OF_DASH = /-+/g;
const MAX_BASE_LEN = 64;

export function sanitiseFilename(species: string, nickname: string, tid: number): string {
  const cleanSpecies = species.replace(SAFE_CHARS, '-').replace(RUN_OF_DASH, '-');
  const cleanNickRaw = nickname.replace(SAFE_CHARS, '-').replace(RUN_OF_DASH, '-');
  const cleanNick = cleanNickRaw.replace(/^-+|-+$/g, '') || 'no-nickname';
  const safeSpecies = cleanSpecies.replace(/^-+|-+$/g, '') || 'unknown';
  let base = `${safeSpecies}-${cleanNick}`;
  if (base.length > MAX_BASE_LEN) base = base.slice(0, MAX_BASE_LEN);
  return `${base}-${tid}.pk3`;
}
