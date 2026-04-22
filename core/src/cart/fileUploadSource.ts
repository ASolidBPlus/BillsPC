/**
 * FileUploadSource — wraps a browser `File` (or in unit tests, a raw
 * Uint8Array + name) so the controller can treat the upload path and
 * the cart path identically.
 *
 * File reads are instant; signal/onProgress are accepted for symmetry
 * with `GbxCartSource` but the file fully resolves in one tick.
 */

import type { SaveSource, SaveSourceOptions, SaveSourceResult } from './saveSource.js';

interface FileLike {
  readonly name: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export class FileUploadSource implements SaveSource {
  readonly label: string;
  constructor(private readonly source: FileLike | { name: string; bytes: Uint8Array }) {
    this.label = source.name;
  }

  async read(opts: SaveSourceOptions = {}): Promise<SaveSourceResult> {
    if (opts.signal?.aborted) {
      throw new Error('aborted');
    }
    const src = this.source as FileLike & { bytes?: Uint8Array };
    let bytes: Uint8Array;
    if (src.bytes instanceof Uint8Array) {
      bytes = src.bytes;
    } else {
      const buf = await src.arrayBuffer();
      bytes = new Uint8Array(buf);
    }
    opts.onProgress?.({ bytesRead: bytes.length, bytesTotal: bytes.length });
    return { bytes, metadata: { name: this.source.name } };
  }
}
