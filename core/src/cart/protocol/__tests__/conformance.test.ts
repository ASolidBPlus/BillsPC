/**
 * Shared "any-protocol" interface conformance — both Insidegadgets and
 * FlashGBX impls pass the same suite. This is the swap-test that
 * guarantees `GbxCartSource` can ride either protocol.
 */
import { describe, it, expect } from 'vitest';
import type { CartProtocol } from '../index.js';
import { InsidegadgetsProtocol } from '../insidegadgets.js';
import { FlashgbxProtocol } from '../flashgbx.js';
import { makeMockPort, ascii, bytes } from './mockPort.js';
import type { MockPort } from './mockPort.js';

interface ProtocolFactory {
  readonly name: 'insidegadgets' | 'lesserkuma';
  readonly make: () => { port: MockPort; protocol: CartProtocol };
  readonly enqueueFwReply: (port: MockPort) => void;
  readonly enqueueGbaSramReply: (port: MockPort, data: Uint8Array) => void;
  readonly enqueueSetModeAcks: (port: MockPort, family: 'gb' | 'gbc' | 'gba') => void;
}

function ack(port: MockPort, n = 1): void {
  for (let i = 0; i < n; i++) port.enqueueRx(bytes(0x01));
}

const factories: ProtocolFactory[] = [
  {
    name: 'insidegadgets',
    make: () => {
      const port = makeMockPort();
      return { port, protocol: new InsidegadgetsProtocol(port) };
    },
    enqueueFwReply: (port) => {
      // V → fw byte; h → pcb byte
      port.enqueueRx(bytes(26));
      port.enqueueRx(bytes(5));
    },
    enqueueGbaSramReply: (port, data) => port.enqueueRx(data),
    enqueueSetModeAcks: () => {
      /* stock setMode is just two byte writes; no acks required */
    },
  },
  {
    name: 'lesserkuma',
    make: () => {
      const port = makeMockPort();
      return { port, protocol: new FlashgbxProtocol(port) };
    },
    enqueueFwReply: (port) => {
      // QUERY_FW_INFO: size=8, cfw='L' (0x4c), fwVer=14 BE, pcb=6, ts=0, name="GBxCart RW", trailers
      port.enqueueRx(bytes(0x08));
      port.enqueueRx(bytes(0x4c, 0x00, 0x0e, 0x06, 0x00, 0x00, 0x00, 0x00));
      port.enqueueRx(bytes(0x0a));
      port.enqueueRx(ascii('GBxCart RW'));
      port.enqueueRx(bytes(0x01, 0x00));
    },
    enqueueGbaSramReply: (port, data) => {
      // 2 setVar acks (TRANSFER_SIZE + ADDRESS) then the data chunk.
      ack(port, 2);
      port.enqueueRx(data);
    },
    enqueueSetModeAcks: (port) => {
      // 3 setVar acks (DMG_READ_METHOD, AGB_READ_METHOD, CART_MODE) +
      // voltage + power + (DMG: MBC reset; AGB: bootup)
      ack(port, 3 + 3);
    },
  },
];

for (const fac of factories) {
  describe(`CartProtocol conformance — ${fac.name}`, () => {
    it('readFirmware returns a populated FirmwareInfo', async () => {
      const { port, protocol } = fac.make();
      fac.enqueueFwReply(port);
      const fw = await protocol.readFirmware();
      expect(fw.banner.length).toBeGreaterThan(0);
      expect(fw.variant).toBe(fac.name);
    });

    it('setMode does not throw for any of {gb, gbc, gba}', async () => {
      const { port, protocol } = fac.make();
      fac.enqueueSetModeAcks(port, 'gb');
      await protocol.setMode('gb');
      fac.enqueueSetModeAcks(port, 'gbc');
      await protocol.setMode('gbc');
      fac.enqueueSetModeAcks(port, 'gba');
      await protocol.setMode('gba');
    });

    it('readSram(gba) returns the requested byte count exactly', async () => {
      const { port, protocol } = fac.make();
      const data = new Uint8Array(64).map((_, i) => (i * 3) & 0xff);
      fac.enqueueGbaSramReply(port, data);
      const out = await protocol.readSram('gba', 64);
      expect(out.length).toBe(64);
      expect(Array.from(out)).toEqual(Array.from(data));
    });

    it('signal aborted before read throws', async () => {
      const { protocol } = fac.make();
      const ctrl = new AbortController();
      ctrl.abort();
      await expect(protocol.readSram('gba', 64, { signal: ctrl.signal })).rejects.toThrow();
    });
  });
}
