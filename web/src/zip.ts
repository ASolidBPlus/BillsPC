/**
 * Thin wrapper over fflate.zipSync. Stored compression (level 0) is
 * fine here — `.pk3` is encrypted random-ish bytes and won't compress.
 *
 * Per PLAN §6.5: the zip path prefix uses a slot index to keep entries
 * unique even when species/nickname/TID collide.
 */
import { zipSync } from 'fflate';

export interface ZipEntry {
  /** Filename inside the zip. */
  readonly name: string;
  readonly bytes: Uint8Array;
}

export function zipFiles(entries: readonly ZipEntry[]): Uint8Array {
  // Deterministic ordering — sort by entry name for stable diffs.
  const sorted = entries.slice().sort((a, b) => a.name.localeCompare(b.name));
  const fileMap: Record<string, Uint8Array> = {};
  for (const e of sorted) {
    fileMap[e.name] = e.bytes;
  }
  return zipSync(fileMap, { level: 0 });
}
