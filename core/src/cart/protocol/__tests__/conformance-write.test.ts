/**
 * S7b — write-side protocol conformance. Mirrors the read-side
 * `conformance.test.ts`: both Insidegadgets and Flashgbx implementations
 * must write to a mock port with the same observable result.
 *
 * Scope is ≤64 KB AGB SRAM + per-byte DMG; the 128 KB AGB Flash path
 * lives only on FlashgbxProtocol (per AMEND-S7b-1 / PLAN §1.3 OOS) and
 * is exercised in `flashgbx-write.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import type { CartProtocol } from '../index.js';
import { InsidegadgetsProtocol } from '../insidegadgets.js';
import { FlashgbxProtocol } from '../flashgbx.js';
import { makeMockPort, bytes } from './mockPort.js';
import type { MockPort } from './mockPort.js';

interface WriteFactory {
  readonly name: 'insidegadgets' | 'lesserkuma';
  readonly make: () => { port: MockPort; protocol: CartProtocol };
  /** Enqueue replies for a single write call of `bytes` against `family`. */
  readonly enqueueWriteReplies: (port: MockPort, family: 'gb' | 'gba', byteCount: number) => void;
}

function ack(port: MockPort, n: number): void {
  for (let i = 0; i < n; i++) port.enqueueRx(bytes(0x01));
}

const factories: WriteFactory[] = [
  {
    name: 'insidegadgets',
    make: () => {
      const port = makeMockPort();
      return { port, protocol: new InsidegadgetsProtocol(port) };
    },
    enqueueWriteReplies: (port, family, byteCount) => {
      if (family === 'gba') {
        const pages = Math.ceil(byteCount / 64);
        for (let i = 0; i < pages; i++) port.enqueueRx(bytes(0x31)); // '1'
      } else {
        for (let i = 0; i < byteCount; i++) port.enqueueRx(bytes(0x31));
      }
    },
  },
  {
    name: 'lesserkuma',
    make: () => {
      const port = makeMockPort();
      return { port, protocol: new FlashgbxProtocol(port) };
    },
    enqueueWriteReplies: (port, family, byteCount) => {
      if (family === 'gba') {
        // Each page: 2 setVar acks + 1 page-write ack.
        const pages = Math.ceil(byteCount / 256);
        ack(port, pages * 3);
      } else {
        // DMG per-page: 6 setVar acks + 1 page-write ack.
        const pages = Math.ceil(byteCount / 256);
        ack(port, pages * 7);
      }
    },
  },
];

for (const fac of factories) {
  describe(`writeSram conformance — ${fac.name}`, () => {
    it('writeSram(gba, 1024) returns without throwing on a happy-mock', async () => {
      const { port, protocol } = fac.make();
      fac.enqueueWriteReplies(port, 'gba', 1024);
      await protocol.writeSram('gba', new Uint8Array(1024).fill(0x55));
    });

    it('writeSram(gb, 256) returns without throwing on a happy-mock', async () => {
      const { port, protocol } = fac.make();
      fac.enqueueWriteReplies(port, 'gb', 256);
      await protocol.writeSram('gb', new Uint8Array(256).fill(0xaa));
    });

    it('writeSram aborts on pre-aborted signal', async () => {
      const { protocol } = fac.make();
      const ctrl = new AbortController();
      ctrl.abort();
      await expect(
        protocol.writeSram('gb', new Uint8Array(64), { signal: ctrl.signal }),
      ).rejects.toThrow();
    });
  });
}
