/**
 * Gen 3 sector checksum.
 *
 * Spec: Bulbapedia §"Sector checksum" + PKHeX `SaveUtil.cs::CHK_GEN3`.
 *
 *   sum = sum of u32 LE words over the body (3884 for sector 0, 3968 elsewhere)
 *   checksum = ((sum & 0xFFFF) + (sum >>> 16)) & 0xFFFF
 *
 * Per PLAN_EVAL A3: sector 0 uses **3884** bytes, sectors 1..13 use
 * **3968**. The naïve "use 3968 across the board" approach happens to
 * work on fresh saves where bytes 3884..3968 of sector 0 are all-zero,
 * but breaks the moment the player's save has any flags set in that
 * region (Emerald extra trainer flags, FR/LG e-Reader scratch).
 */

import { readU32LE } from '../../pack/leBytes.js';
import { sectorBodySize } from './format.js';

/**
 * Compute the Gen 3 sector checksum for a sector body.
 *
 * @param bytes  the FULL save buffer (or any buffer containing the sector)
 * @param sectorOff  byte offset of the start of the sector inside `bytes`
 * @param sectorId  semantic sector_id (0..13); selects 3884 vs 3968
 *                  body-size per A3.
 */
export function gen3SectorChecksum(bytes: Uint8Array, sectorOff: number, sectorId: number): number {
  const size = sectorBodySize(sectorId);
  let sum = 0 >>> 0;
  for (let off = 0; off < size; off += 4) {
    sum = (sum + readU32LE(bytes, sectorOff + off)) >>> 0;
  }
  return ((sum & 0xffff) + (sum >>> 16)) & 0xffff;
}
