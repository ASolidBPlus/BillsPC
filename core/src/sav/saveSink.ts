/**
 * Family-agnostic save-sink interface (per AMEND-S7b-13).
 *
 * Originally lived under `gen3/saveSink.ts` because S6a's only sink was
 * the Gen 3 inject path. S7b adds `GbxCartSink` (Gen 1 / Gen 2 / Gen 3
 * cart writes) + `WriteAndVerifySink` (composable verify decorator) +
 * `BackupSink` (already in web/) — none of which are Gen-3-specific.
 *
 * The interface is intentionally minimal: `write(bytes)` + a `label`. The
 * options bag carries the abort signal and a progress callback that's
 * sub-second-meaningful for cart writes (~16 KB/s for AGB Flash).
 *
 * `gen3/saveSink.ts` re-exports these symbols so existing S6a callers
 * (`web/src/ui/destSink.ts`, the `core/src/sav/gen3/index.ts` barrel) keep
 * working unchanged. New code should import from `@pokeportal/core`
 * directly.
 */

export interface SaveSinkProgress {
  readonly bytesWritten: number;
  readonly bytesTotal: number;
}

export interface SaveSinkOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (p: SaveSinkProgress) => void;
}

/**
 * A save sink writes a complete save buffer to some destination. Options
 * are accepted but may be ignored by fast/instant sinks (FileDownloadSink
 * is instant; GbxCartSink uses both).
 */
export interface SaveSink {
  write(bytes: Uint8Array, opts?: SaveSinkOptions): Promise<void>;
  readonly label: string;
}
