/**
 * Source-format bytes provenance for v2.2 staging — Option C
 * (sentinel-byte JSON snapshot of the parsed `Gen12Pokemon`).
 *
 * Per AMEND-S8v2.2-1 / DECISION-S8v2.2-1, this is the v2.2 PRIMARY
 * encoder for Gen 1/2 source mons added to the transfer box. Option B
 * (slice raw record bytes from `state.sourceBytes` at the SRAM offset)
 * needs a `core/` export that's out of scope for this sprint —
 * `BlockLayout` / `partyLayout()` / `boxLayout()` etc. are
 * module-private to `core/src/sav/gen{1,2}/writer.ts`. A future sprint
 * can add `extractMonRecordGen{1,2}()` exports to core and switch the
 * v2.2 path to raw bytes; the sentinel byte makes both encodings
 * coexist on the storage layer (the commit-time decoder reads the
 * sentinel to route).
 *
 * TODO(s8v2.3+): replace the JSON path with a raw-byte slicer once
 * `core/` exposes the per-format record offsets. Tracked in
 * AMEND-S8v2.2-1 for future reference.
 */

import type { Gen12Pokemon } from '@pokeportal/core';

/** Sentinel byte tag indicating "this slot's pkBytes is a JSON-encoded
 *  Gen12Pokemon" — read at v2.3 commit time to route decoding. */
export const STAGING_PAYLOAD_GEN12_JSON = 0xfe;

/**
 * Encode a parsed `Gen12Pokemon` into the v2.2 sentinel-prefixed JSON
 * shape. Uint8Array fields are converted to plain number arrays so the
 * structure round-trips cleanly through JSON.stringify; the decoder is
 * responsible for re-wrapping them in `Uint8Array`.
 */
export function serializeGen12ForStaging(mon: Gen12Pokemon): Uint8Array {
  // Convert Uint8Array fields to plain arrays for JSON.stringify
  // (which would otherwise serialize them as `{ "0": 1, "1": 2, ... }`
  // objects — survivable but ugly + larger).
  const plain: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(mon)) {
    if (v instanceof Uint8Array) {
      plain[k] = { __u8: Array.from(v) };
    } else {
      plain[k] = v;
    }
  }
  const json = JSON.stringify(plain);
  const enc = new TextEncoder();
  const body = enc.encode(json);
  const out = new Uint8Array(1 + body.length);
  out[0] = STAGING_PAYLOAD_GEN12_JSON;
  out.set(body, 1);
  return out;
}

/**
 * Inverse of `serializeGen12ForStaging`. Returns null if the bytes
 * don't carry the v2.2 sentinel (caller should fall back to legacy
 * decoding paths). The v2.3 commit code will call this; v2.2 only
 * encodes (the renderer never re-parses; it reads the frozen
 * `speciesId` / `nicknameDisplay` fields off the slot).
 */
export function deserializeGen12FromStaging(bytes: Uint8Array): Gen12Pokemon | null {
  if (bytes.length < 1 || bytes[0] !== STAGING_PAYLOAD_GEN12_JSON) return null;
  const dec = new TextDecoder();
  const json = dec.decode(bytes.subarray(1));
  const parsed = JSON.parse(json) as Record<string, unknown>;
  const mon: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (v && typeof v === 'object' && '__u8' in (v as object)) {
      mon[k] = new Uint8Array((v as { __u8: number[] }).__u8);
    } else {
      mon[k] = v;
    }
  }
  return mon as unknown as Gen12Pokemon;
}
