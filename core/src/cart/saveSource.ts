/**
 * SaveSource — symmetric with `SaveSink` (core/src/sav/gen3/saveSink.ts).
 *
 * The S3a stub at `core/src/types/sav.ts` has no real callers (it was
 * forward-design for what S3b/S6b/S7a now ship). This is the live
 * interface the cart-mode flow consumes; the legacy `SaveSource` export
 * is kept for backwards compatibility and now re-exports this widened
 * shape.
 *
 * AMEND-S6a-4 froze `SaveSink` so the cart sink can drop in. We mirror
 * `SaveSink` here so the cart source likewise drops into the controller
 * with no further widening.
 */

export interface SaveSourceProgress {
  readonly bytesRead: number;
  readonly bytesTotal: number;
}

export interface SaveSourceOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (p: SaveSourceProgress) => void;
}

export interface SaveSourceResult {
  readonly bytes: Uint8Array;
  readonly metadata: SaveSourceMetadata;
}

export interface SaveSourceMetadata {
  readonly name: string;
  readonly family?: 'gen1' | 'gen2' | 'gen3';
  readonly deviceId?: string;
}

export interface SaveSource {
  read(opts?: SaveSourceOptions): Promise<SaveSourceResult>;
  readonly label: string;
}
