/**
 * Round-trip comparator that compares every field of `Gen3Intermediate`
 * EXCEPT `_meta` and EXCEPT `level`/`nature` (party-tail-only and
 * not-on-wire respectively — see `boxed.ts`/`party.ts` comments).
 *
 * For `_meta`, asserts only that `b._meta.warnings` includes the
 * "decoded-from-bytes:" sentinel.
 *
 * Returns `true` on equality, or `{ path, a, b }` describing the first
 * divergence. Designed so callers can `expect(eq).toBe(true)` and read
 * the failure path from the test diff (PLAN_EVAL A5).
 */

import type { Gen3Intermediate } from '../../core/src/types/target.js';

type Diff = { path: string; a: unknown; b: unknown };

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function objEqual(a: Record<string, number>, b: Record<string, number>, path: string): true | Diff {
  for (const k of Object.keys(a)) {
    if (a[k] !== b[k]) return { path: `${path}.${k}`, a: a[k], b: b[k] };
  }
  return true;
}

export function intermediateDeepEqualExceptMeta(
  a: Gen3Intermediate,
  b: Gen3Intermediate,
): true | Diff {
  if (a.species !== b.species) return { path: 'species', a: a.species, b: b.species };
  if (!bytesEqual(a.nickname, b.nickname))
    return { path: 'nickname', a: [...a.nickname], b: [...b.nickname] };
  if (!bytesEqual(a.otName, b.otName))
    return { path: 'otName', a: [...a.otName], b: [...b.otName] };
  if (a.otGender !== b.otGender) return { path: 'otGender', a: a.otGender, b: b.otGender };
  if (a.tid !== b.tid) return { path: 'tid', a: a.tid, b: b.tid };
  if (a.sid !== b.sid) return { path: 'sid', a: a.sid, b: b.sid };
  if (a.pid !== b.pid) return { path: 'pid', a: a.pid, b: b.pid };
  const ivs = objEqual(a.ivs as Record<string, number>, b.ivs as Record<string, number>, 'ivs');
  if (ivs !== true) return ivs;
  const evs = objEqual(a.evs as Record<string, number>, b.evs as Record<string, number>, 'evs');
  if (evs !== true) return evs;
  // skip `nature` and `level` — not present in boxed wire (see boxed.ts).
  if (a.abilitySlot !== b.abilitySlot)
    return { path: 'abilitySlot', a: a.abilitySlot, b: b.abilitySlot };
  for (let i = 0; i < 4; i++) {
    if (a.moves[i] !== b.moves[i]) return { path: `moves[${i}]`, a: a.moves[i], b: b.moves[i] };
    if (a.pp[i] !== b.pp[i]) return { path: `pp[${i}]`, a: a.pp[i], b: b.pp[i] };
    if (a.ppUps[i] !== b.ppUps[i]) return { path: `ppUps[${i}]`, a: a.ppUps[i], b: b.ppUps[i] };
  }
  if (a.heldItem !== b.heldItem) return { path: 'heldItem', a: a.heldItem, b: b.heldItem };
  if (a.friendship !== b.friendship)
    return { path: 'friendship', a: a.friendship, b: b.friendship };
  if (a.exp !== b.exp) return { path: 'exp', a: a.exp, b: b.exp };
  if (a.pokerus !== b.pokerus) return { path: 'pokerus', a: a.pokerus, b: b.pokerus };
  const cs = objEqual(
    a.contestStats as Record<string, number>,
    b.contestStats as Record<string, number>,
    'contestStats',
  );
  if (cs !== true) return cs;
  if (a.ribbons.length !== b.ribbons.length)
    return { path: 'ribbons.length', a: a.ribbons.length, b: b.ribbons.length };
  if (a.markings !== b.markings) return { path: 'markings', a: a.markings, b: b.markings };
  if (a.metLocation !== b.metLocation)
    return { path: 'metLocation', a: a.metLocation, b: b.metLocation };
  if (a.metLevel !== b.metLevel) return { path: 'metLevel', a: a.metLevel, b: b.metLevel };
  if (a.metGame !== b.metGame) return { path: 'metGame', a: a.metGame, b: b.metGame };
  if (a.originGame !== b.originGame)
    return { path: 'originGame', a: a.originGame, b: b.originGame };
  if (a.fatefulEncounter !== b.fatefulEncounter)
    return { path: 'fatefulEncounter', a: a.fatefulEncounter, b: b.fatefulEncounter };
  if (a.isEgg !== b.isEgg) return { path: 'isEgg', a: a.isEgg, b: b.isEgg };
  if (a.language !== b.language) return { path: 'language', a: a.language, b: b.language };
  // _meta: only check the decoded sentinel is present in `b`.
  if (!b._meta.warnings.some((w) => w.startsWith('decoded-from-bytes:'))) {
    return {
      path: '_meta.warnings',
      a: '[decoded-from-bytes: ...]',
      b: [...b._meta.warnings],
    };
  }
  return true;
}
