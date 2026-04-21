import type { Gen12Pokemon } from '../types/source.js';
import { hashConcat } from './hash.js';

/**
 * Derive a stable 32-byte personality seed from source fields. The seed is
 * then domain-separated with a tag (e.g. 'iv' or 'pid') before being fed to
 * the RNG or PID search.
 *
 * Inputs (in order):
 *   otNameBytes || u16le(tid) || u16le(speciesGen2Id) || dvBytes || sourcePersonalityBytes?
 *
 * `dvBytes` are 4 bytes `[atk, def, spe, special]`. This makes the seed
 * depend on per-Pokemon identity (DVs) as well as trainer identity, so
 * different DVs on otherwise identical source Pokemon still yield different
 * PIDs.
 */
export function personalitySeed(src: Gen12Pokemon): Uint8Array {
  const tidBytes = new Uint8Array([src.tid & 0xff, (src.tid >>> 8) & 0xff]);
  const speciesBytes = new Uint8Array([src.speciesGen2Id & 0xff, (src.speciesGen2Id >>> 8) & 0xff]);
  const dvBytes = new Uint8Array([
    src.dvs.atk & 0x0f,
    src.dvs.def & 0x0f,
    src.dvs.spe & 0x0f,
    src.dvs.special & 0x0f,
  ]);

  if (src.sourcePersonalityBytes) {
    return hashConcat(src.otNameBytes, tidBytes, speciesBytes, dvBytes, src.sourcePersonalityBytes);
  }
  return hashConcat(src.otNameBytes, tidBytes, speciesBytes, dvBytes);
}
