/**
 * Stream-framing primitives for the GBxCart serial transport.
 *
 * The GBxCart is USB-CDC-ACM. The OS may chunk reads at unpredictable
 * boundaries (per PLAN R3) so `readExactly` loops on the reader until N
 * bytes have accumulated or the signal aborts. `readUntil` is used for
 * banner / line responses ('V' returns an ASCII banner terminated by
 * \n).
 *
 * No protocol semantics live here — all command-shape knowledge lives
 * in the per-protocol impls under `protocol/`.
 */

import { CartError, type Port } from '../types.js';
import { dlogRx, dlogTx } from './debug.js';

export class FrameReader {
  private buf: Uint8Array = new Uint8Array(0);
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private released = false;

  constructor(private readonly port: Port) {}

  acquire(): void {
    if (this.reader) return;
    this.reader = this.port.readable.getReader();
    this.released = false;
  }

  release(): void {
    if (this.reader && !this.released) {
      try {
        this.reader.releaseLock();
      } catch {
        /* readers already cancelled — ignore */
      }
      this.released = true;
      this.reader = null;
    }
  }

  /** Returns whatever bytes are sitting in the local accumulator. */
  pending(): Uint8Array {
    return this.buf;
  }

  /** Drop any pending buffered bytes (called between commands when the
   *  firmware leaves trailing bytes that aren't part of the next command's
   *  reply — e.g. an unread newline after the banner). */
  flush(): void {
    this.buf = new Uint8Array(0);
  }

  async readExactly(
    n: number,
    opts: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<Uint8Array> {
    if (n <= 0) return new Uint8Array(0);
    this.acquire();
    const deadline = opts.timeoutMs !== undefined ? Date.now() + opts.timeoutMs : Infinity;
    while (this.buf.length < n) {
      if (opts.signal?.aborted) throw new CartError('CANCELLED', 'read aborted by signal');
      if (Date.now() > deadline)
        throw new CartError('TIMEOUT', `read timed out after ${opts.timeoutMs ?? 0}ms`);
      const remainingMs = deadline === Infinity ? undefined : Math.max(1, deadline - Date.now());
      const chunk = await this.readChunk(opts.signal, remainingMs);
      if (chunk === null) {
        throw new CartError('DISCONNECTED', 'serial port closed mid-read');
      }
      this.buf = concat(this.buf, chunk);
    }
    const out = copy(this.buf, 0, n);
    this.buf = copy(this.buf, n, this.buf.length);
    return out;
  }

  async readUntil(
    byte: number,
    opts: { signal?: AbortSignal; timeoutMs?: number; max?: number } = {},
  ): Promise<Uint8Array> {
    this.acquire();
    const deadline = opts.timeoutMs !== undefined ? Date.now() + opts.timeoutMs : Infinity;
    const max = opts.max ?? 1024;
    for (;;) {
      const idx = this.buf.indexOf(byte);
      if (idx >= 0) {
        const out = copy(this.buf, 0, idx);
        this.buf = copy(this.buf, idx + 1, this.buf.length);
        return out;
      }
      if (this.buf.length > max) {
        throw new CartError(
          'CORRUPTED_RESPONSE',
          `readUntil exceeded ${max} bytes without sentinel`,
        );
      }
      if (opts.signal?.aborted) throw new CartError('CANCELLED', 'read aborted by signal');
      if (Date.now() > deadline) throw new CartError('TIMEOUT', `readUntil timed out`);
      const remainingMs = deadline === Infinity ? undefined : Math.max(1, deadline - Date.now());
      const chunk = await this.readChunk(opts.signal, remainingMs);
      if (chunk === null) {
        // Stream closed — return whatever we accumulated as the final value
        // so banner-style probes can succeed even without a trailing newline.
        const out = this.buf;
        this.buf = new Uint8Array(0);
        return out;
      }
      this.buf = concat(this.buf, chunk);
    }
  }

  private async readChunk(
    signal: AbortSignal | undefined,
    timeoutMs: number | undefined,
  ): Promise<Uint8Array | null> {
    if (!this.reader) throw new CartError('DISCONNECTED', 'reader not acquired');
    const reader = this.reader;
    const racers: Promise<
      { kind: 'data'; value: Uint8Array | null } | { kind: 'abort' } | { kind: 'timeout' }
    >[] = [reader.read().then((r) => ({ kind: 'data' as const, value: r.done ? null : r.value }))];
    if (signal) {
      racers.push(
        new Promise((resolve) => {
          if (signal.aborted) return resolve({ kind: 'abort' as const });
          const onAbort = (): void => resolve({ kind: 'abort' as const });
          signal.addEventListener('abort', onAbort, { once: true });
        }),
      );
    }
    if (timeoutMs !== undefined) {
      racers.push(
        new Promise((resolve) => {
          setTimeout(() => resolve({ kind: 'timeout' as const }), timeoutMs);
        }),
      );
    }
    const winner = await Promise.race(racers);
    if (winner.kind === 'abort') throw new CartError('CANCELLED', 'read aborted by signal');
    if (winner.kind === 'timeout')
      throw new CartError('TIMEOUT', `chunk timed out after ${timeoutMs}ms`);
    if (winner.value) dlogRx(winner.value);
    return winner.value ?? null;
  }
}

export async function writeAll(port: Port, bytes: Uint8Array): Promise<void> {
  dlogTx(bytes);
  const writer = port.writable.getWriter();
  try {
    await writer.write(bytes);
  } finally {
    writer.releaseLock();
  }
}

export function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return copy(b, 0, b.length);
  if (b.length === 0) return copy(a, 0, a.length);
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function copy(src: Uint8Array, start: number, end: number): Uint8Array {
  const len = Math.max(0, end - start);
  const out = new Uint8Array(len);
  if (len > 0) out.set(src.subarray(start, end), 0);
  return out;
}

export async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let to: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        to = setTimeout(
          () => reject(new CartError('TIMEOUT', `${label} timed out after ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (to) clearTimeout(to);
  }
}
