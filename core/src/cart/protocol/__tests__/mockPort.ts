/**
 * Test helper — duck-typed `Port` impl backed by two in-memory queues.
 *
 *   - `txLog` records every byte the host wrote (the protocol-under-test).
 *   - `rxQueue` is a list of byte chunks that will be returned to the
 *     reader, one per `read()` call.
 *
 * Tests script the rxQueue per-command so they can pin the protocol's
 * exact wire interactions.
 */

import type { Port } from '../../types.js';

export interface MockPort extends Port {
  readonly txLog: number[];
  readonly txAscii: () => string;
  enqueueRx(...chunks: Uint8Array[]): void;
  closed: boolean;
}

export function makeMockPort(): MockPort {
  const txLog: number[] = [];
  const rxQueue: Uint8Array[] = [];
  let pendingResolve: ((v: { value?: Uint8Array; done?: boolean }) => void) | null = null;

  const readable = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (rxQueue.length > 0) {
        controller.enqueue(rxQueue.shift()!);
        return;
      }
      // Park: when enqueueRx is called next, we'll resolve via the
      // pending pointer.
      return new Promise<void>((resolve) => {
        pendingResolve = (v) => {
          if (v.done) controller.close();
          else if (v.value) controller.enqueue(v.value);
          pendingResolve = null;
          resolve();
        };
      });
    },
  });

  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      for (const b of chunk) txLog.push(b);
    },
  });

  const port: MockPort = {
    readable,
    writable,
    txLog,
    txAscii: () => String.fromCharCode(...txLog),
    closed: false,
    enqueueRx(...chunks) {
      for (const c of chunks) {
        if (pendingResolve) {
          pendingResolve({ value: c });
        } else {
          rxQueue.push(c);
        }
      }
    },
    async close() {
      port.closed = true;
      if (pendingResolve) pendingResolve({ done: true });
    },
  };
  return port;
}

export function bytes(...vals: number[]): Uint8Array {
  return new Uint8Array(vals);
}

export function ascii(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}
