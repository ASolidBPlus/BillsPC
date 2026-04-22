/**
 * Save sink interface (per PLAN_EVAL A12 — freeze point for S6b GBxCart).
 *
 * S6a's `FileDownloadSink` (lives in `web/src/ui/destSink.ts` — it uses
 * DOM APIs that don't typecheck under the core's ES2022-only lib) is
 * instant — it ignores `opts`. S6b's `GbxCartSink` writes 128 KB to SRAM
 * at ~16 KB/s; it will use both `signal` (cancel via AbortController) and
 * `onProgress` (UI progress bar). Defining the interface NOW means S6b
 * can ship a new implementation without touching any S6a callsite — the
 * `.write(bytes)` call already accepts `opts`, just to-date no caller
 * passes them.
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
 * is instant; GbxCartSink will use both fields).
 */
export interface SaveSink {
  write(bytes: Uint8Array, opts?: SaveSinkOptions): Promise<void>;
  readonly label: string;
}
