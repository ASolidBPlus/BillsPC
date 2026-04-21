/**
 * Little-endian byte helpers. The GBA is little-endian throughout, and
 * every Gen 3 wire-format word is LE — keep all endianness logic here so
 * the rest of the packer/unpacker is endianness-agnostic.
 *
 * All readers/writers `>>> 0` their u32 outputs/inputs to keep them
 * unsigned in JS's signed-int32 bitwise world. `(2**31) | 0` is -2**31
 * without `>>> 0`; downstream comparisons would silently break.
 */

export function readU16LE(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.length) {
    throw new RangeError(`readU16LE out of range: offset=${offset}, len=${bytes.length}`);
  }
  return (bytes[offset]! | (bytes[offset + 1]! << 8)) & 0xffff;
}

export function readU32LE(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) {
    throw new RangeError(`readU32LE out of range: offset=${offset}, len=${bytes.length}`);
  }
  return (
    (bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16) |
      (bytes[offset + 3]! << 24)) >>>
    0
  );
}

export function writeU16LE(bytes: Uint8Array, offset: number, value: number): void {
  if (offset < 0 || offset + 2 > bytes.length) {
    throw new RangeError(`writeU16LE out of range: offset=${offset}, len=${bytes.length}`);
  }
  const v = value & 0xffff;
  bytes[offset] = v & 0xff;
  bytes[offset + 1] = (v >>> 8) & 0xff;
}

export function writeU32LE(bytes: Uint8Array, offset: number, value: number): void {
  if (offset < 0 || offset + 4 > bytes.length) {
    throw new RangeError(`writeU32LE out of range: offset=${offset}, len=${bytes.length}`);
  }
  const v = value >>> 0;
  bytes[offset] = v & 0xff;
  bytes[offset + 1] = (v >>> 8) & 0xff;
  bytes[offset + 2] = (v >>> 16) & 0xff;
  bytes[offset + 3] = (v >>> 24) & 0xff;
}

/** Defensive u32 normaliser. Use anywhere a PID-derived value is computed. */
export function u32(x: number): number {
  return x >>> 0;
}
