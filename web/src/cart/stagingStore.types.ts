/**
 * Staging-store schema types.
 *
 * S8v2.2 — REWRITE per AMEND-S8v2.2-R1: the canonical shape is a
 * 30-slot fixed-capacity grid that maps 1:1 onto a Gen 3 PC box. Slots
 * are addressed by 0-based `idx` (0..29); each slot is either `null`
 * (empty) or a `StagedSlot` record (occupied).
 *
 * The legacy `StagedMon` / `StagingSessionV1` shapes are retained as
 * `@deprecated` aliases so the legacy `stagingPane.ts` (and any other
 * S7b consumer) keeps working through the deprecated shim API on
 * `StagingStore`. A future v2-cleanup sprint will remove both.
 *
 * Per AMEND-S7b-17 #4 — for Gen 1/2 → Gen 3 conversion the stored
 * bytes are the SOURCE-format bytes (Gen 1/2 raw record). Conversion
 * happens at place-time. Keeps the staging record format-stable across
 * the source/dest gap.
 *
 * For the v2.2 path specifically (per AMEND-S8v2.2-1 / DECISION-1), the
 * `pkBytes` carries one of three encodings, identified by the
 * leading sentinel byte:
 *
 *   pkBytes[0] === 0xFE → JSON-encoded Gen12Pokemon (v2.2 fallback).
 *                          Produced by `serializeGen12ForStaging()`.
 *   pkBytes[0] === 0xFF → JSON-encoded Gen3 boxed slot (reserved future).
 *   otherwise           → raw byte record (legacy `buildDestStoreProp`
 *                          Gen 3 path — the 80-byte encrypted Gen 3 PC
 *                          slot — unchanged; or a future Option-B raw
 *                          source-byte slice).
 *
 * The S8v2.3 commit code reads `pkBytes[0]` AND/OR the slot's
 * `sourceFamily` to route decoding.
 */

export interface StagedMonDestinationGen3 {
  readonly destCartLabel: string;
  readonly destTid: number;
  readonly destFormat: 'ruby' | 'sapphire' | 'emerald' | 'firered' | 'leafgreen';
  readonly destBoxIndex: number;
  readonly destSlot: number;
}

export interface StagedMonSourceRef {
  readonly bucket: 'party' | 'currentBox' | 'box';
  readonly boxIndex?: number;
  readonly slot: number;
}

/**
 * @deprecated v2-cleanup candidate — new code should use `StagedSlot`.
 *
 * Retained because the legacy `stagingPane.ts` UI + the `composeSourceWrite`
 * / `composeDestinationWrite` helpers both consume this shape. The
 * `StagingStore.subscribe(legacy)` shim synthesizes a `StagingSessionV1`
 * out of the slot-addressed snapshot per AMEND-S8v2.2-2.
 */
export interface StagedMon {
  /**
   * Source-format bytes (or v2.2 sentinel-prefixed fallback per the
   * file-level comment above).
   */
  readonly pkBytes: Uint8Array;
  readonly sourceCartLabel: string;
  readonly sourceTid: number;
  readonly sourceFamily: 'gen1' | 'gen2' | 'gen3';
  readonly sourceOtName: string;
  readonly speciesId: number;
  readonly nicknameDisplay: string;
  readonly stagedAt: string; // ISO date — stable id within the session
  readonly sourceRef: StagedMonSourceRef;
  readonly destination: StagedMonDestinationGen3 | null;
}

/**
 * @deprecated v2-cleanup candidate — new code reads `StagingSnapshot`
 * (the slot-addressed view) via `StagingStore.subscribeSlots`.
 *
 * The `StagingStore.subscribe(legacy)` shim still produces this shape
 * for the legacy `stagingPane.ts` and the controller's `staging_loaded`
 * dispatch. AMEND-S8v2.2-2 pins down the synthesis exactly so byte-for-
 * byte legacy parity is preserved.
 */
export interface StagingSessionV1 {
  readonly schemaVersion: 1;
  readonly id: 'default';
  readonly stagedMons: ReadonlyArray<StagedMon>;
  readonly sessionMetadata: {
    readonly createdAt: string;
    readonly lastModifiedAt: string;
  };
}

/**
 * v2.2 — destination annotation for a placed staged slot. The
 * placement is a PROMISE about where the mon will land at commit-time;
 * v2.2 only sets the annotation, v2.3 commit actually writes the bytes
 * + clears the slot.
 *
 * `destFormat` is collapsed from the legacy 5-way enum to a 2-way
 * format-family enum because the Gen 3 conversion path only forks on
 * RSE-vs-FRLG (the per-game-id distinctions inside each family don't
 * change the conversion result). The legacy v1 destination's
 * `destFormat` value is mapped on migration:
 *   ruby/sapphire/emerald → 'rse'
 *   firered/leafgreen     → 'frlg'
 */
export interface StagedPlacement {
  readonly destBoxIndex: number;
  readonly destSlot: number;
  readonly destCartLabel: string;
  readonly destTid: number;
  readonly destFormat: 'frlg' | 'rse';
}

/**
 * v2.2 — slot-addressed staged mon. `idx` is the 0..29 position in
 * the transfer box and is the canonical stable id (replaces
 * `stagedAt` from the legacy schema). `placement` carries the
 * pending-but-uncommitted destination annotation.
 *
 * `speciesId` is the POST-CONVERSION ndex per AMEND-S8v2.2-8 — when
 * `convert(mon, deps)` returns a different `speciesGen2Id` than the
 * source mon's, this field carries the destination-side species so
 * the transfer-box sprite previews the post-conversion form.
 */
export interface StagedSlot {
  readonly idx: number;
  readonly pkBytes: Uint8Array;
  readonly speciesId: number;
  readonly nicknameDisplay: string;
  readonly sourceCartLabel: string;
  readonly sourceTid: number;
  readonly sourceFamily: 'gen1' | 'gen2' | 'gen3';
  readonly sourceOtName: string;
  readonly sourceRef: StagedMonSourceRef;
  /**
   * Per CLAR-7 — `${cartLabel}|${tid}|box:${boxIndex}:${slot}` (or the
   * non-box bucket equivalent). Stored explicitly so `isStaged(key)` is
   * an O(occupied) scan rather than re-derive-per-call.
   */
  readonly sourceRefKey: string;
  /** ISO timestamp — metadata only. NOT a stable id. */
  readonly stagedAt: string;
  readonly placement: StagedPlacement | null;
  /**
   * v2.3 — true after the source-side cart/SAV write has been committed
   * (the source bytes have the mon DELETED, on-disk or on-cart). False
   * during the placement-only window. Defaults to `false` on `placeAt`;
   * flipped via `setSourceCommitted(idx, true)` after a successful
   * source commit. Persisted in IDB so the bonded state survives a
   * close/reopen across the source-commit / SWITCH / dest-commit
   * sequence.
   */
  readonly sourceCommitted?: boolean;
}

/**
 * v2.2 — the canonical session shape stored in IDB. Length always 30.
 */
export interface StagingSessionV2 {
  readonly schemaVersion: 2;
  readonly id: 'default';
  readonly slots: ReadonlyArray<StagedSlot | null>;
  readonly sessionMetadata: {
    readonly createdAt: string;
    readonly lastModifiedAt: string;
  };
}

/** Convenience alias for what `subscribeSlots` listeners receive. */
export type StagingSnapshot = ReadonlyArray<StagedSlot | null>;

export const STAGING_DB_NAME = 'pokeportal' as const;
export const STAGING_OBJECT_STORE = 'staging' as const;
export const STAGING_DEFAULT_ID = 'default' as const;
export const STAGING_BROADCAST_CHANNEL = 'pokeportal-staging' as const;
export const STAGING_SLOT_COUNT = 30 as const;
