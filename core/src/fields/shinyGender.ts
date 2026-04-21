/**
 * Shiny check and gender derivation helpers.
 *
 * Gen 3 shiny check: `(TID ^ SID ^ (PID >> 16) ^ (PID & 0xFFFF)) < 8`.
 */
export function gen3ShinyCheck(tid: number, sid: number, pid: number): boolean {
  const pidHi = (pid >>> 16) & 0xffff;
  const pidLo = pid & 0xffff;
  const xor = (tid ^ sid ^ pidHi ^ pidLo) & 0xffff;
  return xor < 8;
}

/**
 * Gender from Gen 3 PID + species gender-ratio byte.
 *   255 → genderless (2)
 *   254 → female-only (1)
 *   0   → male-only (0)
 *   else: `(pid & 0xFF) < ratio` ⇒ female (1), else male (0).
 */
export function gen3Gender(pid: number, genderRatioByte: number): 0 | 1 | 2 {
  if (genderRatioByte === 255) return 2;
  if (genderRatioByte === 254) return 1;
  if (genderRatioByte === 0) return 0;
  return (pid & 0xff) < genderRatioByte ? 1 : 0;
}
