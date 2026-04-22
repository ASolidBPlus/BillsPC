/**
 * Browser-side `SaveSink` implementation. Wraps the existing
 * `blobDownload` helper so the inject-pipeline-side stays sink-agnostic.
 *
 * Per PLAN_EVAL A12: this is the FREEZE POINT for the SaveSink interface.
 * S6b will add a `GbxCartSink` (Web Serial) that conforms to the same
 * `SaveSink` interface — both `signal` (cancel) and `onProgress`
 * (progress UI) will be wired through then. S6a's `FileDownloadSink`
 * ignores both fields because the write is instant.
 */
import type { SaveSink, SaveSinkOptions } from '@pokeportal/core';
import { blobDownload } from '../download.js';

export class FileDownloadSink implements SaveSink {
  readonly label = 'Download .sav file';
  constructor(public readonly suggestedFilename: string) {}
  async write(bytes: Uint8Array, _opts?: SaveSinkOptions): Promise<void> {
    void _opts; // FileDownloadSink ignores progress/cancel — write is instant.
    blobDownload(this.suggestedFilename, bytes);
  }
}
