import { describe, it, expect } from 'vitest';
import { detectProtocol } from '../detect.js';
import { makeMockPort, ascii, bytes } from './mockPort.js';
import { CartError } from '../../types.js';

/** LK QUERY_FW_INFO response framing (per FlashGBX hw_GBxCartRW.py): */
function lkFwInfoReply(opts: {
  cfwId?: string; // 'L' for Lesserkuma; '' to mark as not-CFW (no name block)
  fwVer?: number; // 16-bit BE
  pcbVer?: number;
  fwTs?: number;
  name?: string;
}): Uint8Array[] {
  const { cfwId = 'L', fwVer = 14, pcbVer = 6, fwTs = 0, name = 'GBxCart RW' } = opts;
  const meta = new Uint8Array(8);
  meta[0] = cfwId === '' ? 0 : cfwId.charCodeAt(0);
  meta[1] = (fwVer >>> 8) & 0xff;
  meta[2] = fwVer & 0xff;
  meta[3] = pcbVer;
  meta[4] = (fwTs >>> 24) & 0xff;
  meta[5] = (fwTs >>> 16) & 0xff;
  meta[6] = (fwTs >>> 8) & 0xff;
  meta[7] = fwTs & 0xff;
  const out: Uint8Array[] = [bytes(0x08), meta];
  if (cfwId === 'L' && fwVer >= 12) {
    out.push(bytes(name.length));
    out.push(ascii(name));
    out.push(bytes(0x01, 0x00)); // cart_power_ctrl + bootloader_reset trailers
  }
  return out;
}

describe('detectProtocol', () => {
  it('returns FlashgbxProtocol when V byte is sane AND QUERY_FW_INFO returns L-CFW banner', async () => {
    const port = makeMockPort();
    // Stock V byte (back-compat) — but +L14 CFW is layered, so detect must
    // pick FlashgbxProtocol since LK responds to QUERY_FW_INFO.
    port.enqueueRx(bytes(42));
    for (const chunk of lkFwInfoReply({ fwVer: 14, pcbVer: 6, name: 'GBxCart RW' })) {
      port.enqueueRx(chunk);
    }
    const result = await detectProtocol(port);
    expect(result.protocol.variant).toBe('lesserkuma');
    expect(result.banner).toContain('GBxCart RW');
    expect(result.banner).toContain('L14');
  });

  it('returns InsidegadgetsProtocol when V byte is sane AND QUERY_FW_INFO yields no LK extension', async () => {
    const port = makeMockPort();
    // Stock V byte 26 → R26 firmware. LK probe responds with size-byte=0
    // (or any non-8 value) which signals "no LK CFW present". Detect should
    // then fall back to InsidegadgetsProtocol.
    port.enqueueRx(bytes(26));
    port.enqueueRx(bytes(0x00)); // metaSize != 8 → fall back
    const result = await detectProtocol(port);
    expect(result.protocol.variant).toBe('insidegadgets');
    expect(result.banner).toContain('R26');
  });

  it('throws UNSUPPORTED_FIRMWARE_VARIANT when neither probe yields a usable response', async () => {
    const port = makeMockPort();
    // V → out-of-range byte (255 — not a real fw version).
    port.enqueueRx(bytes(0xff));
    // LK probe: size-byte 0 → not LK either.
    port.enqueueRx(bytes(0x00));
    await expect(detectProtocol(port)).rejects.toThrow(CartError);
  });
});
