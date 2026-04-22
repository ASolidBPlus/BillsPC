/**
 * Thin browser-side wrapper around `navigator.serial.requestPort()`.
 *
 * Returns a `Port` (per `core/src/cart/types.ts`) that the protocol
 * layer can read/write against. The DOM `SerialPort` already satisfies
 * the duck-type — we just need to call `open()` first.
 *
 * Per PLAN §4: open with `{ baudRate: 1000000, bufferSize: 16384 }`
 * (FlashGBX's known-good values). The firmware ignores baud rate over
 * USB-CDC-ACM but the driver requires *some* value.
 */

import type { Port } from '@pokeportal/core';

interface SerialOpenOptions {
  baudRate: number;
  bufferSize?: number;
}

interface BrowserSerialPort {
  open(opts: SerialOpenOptions): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  addEventListener?(event: 'disconnect', listener: () => void): void;
  removeEventListener?(event: 'disconnect', listener: () => void): void;
}

interface BrowserSerial {
  requestPort(opts?: {
    filters?: { usbVendorId?: number; usbProductId?: number }[];
  }): Promise<BrowserSerialPort>;
}

interface NavigatorWithSerial {
  serial?: BrowserSerial;
}

// Known USB IDs for GBxCart RW variants:
//   - v1.4 PCB stock + Lesserkuma reflash: 0x1d50 / 0x6018  (OpenMoko / InsideGadgets)
//   - v1.3 CH34x USB-serial bridge:        0x1a86 / 0x7523
//   - Some reflashes / dev firmware:        0x16c0 / 0x05dc  (V-USB generic)
// We pass all three as filters so the picker shows any GBxCart variant.
const GBXCART_FILTERS = [
  { usbVendorId: 0x1d50, usbProductId: 0x6018 },
  { usbVendorId: 0x1a86, usbProductId: 0x7523 },
  { usbVendorId: 0x16c0, usbProductId: 0x05dc },
];

export async function requestCartPort(): Promise<Port> {
  const nav = navigator as unknown as NavigatorWithSerial;
  if (!nav.serial) {
    throw new Error('Web Serial not available');
  }
  // Pass an empty filter array (or omit) to let the user pick ANY serial
  // device. We default to the GBxCart-specific filter set to declutter the
  // picker. Power users with non-stock firmware that reports a different
  // VID can still see their device by checking "Show all devices" if the
  // browser exposes it, OR by patching the filter list locally.
  const sp = await nav.serial.requestPort({ filters: GBXCART_FILTERS });
  // Web Serial caches granted permissions per origin and may hand back a
  // SerialPort that's still open from a previous session (page reload mid-
  // read, error path that didn't reach close, etc.). Force-close it first
  // so the subsequent open() doesn't throw "port is already open".
  try {
    await sp.close();
  } catch {
    /* not open — fine */
  }
  await sp.open({ baudRate: 1_000_000, bufferSize: 16_384 });
  // The cart's UART resets when DTR toggles on port-open. The firmware
  // needs ~1-2s to re-enumerate before it responds. FlashGBX waits
  // ~250ms; we wait 1500ms for safety on slower USB stacks.
  await new Promise((resolve) => setTimeout(resolve, 1500));
  return adaptPort(sp);
}

function adaptPort(sp: BrowserSerialPort): Port {
  // Use getters for readable/writable: when the underlying SerialPort is
  // closed + re-opened (via reopenAtBaud) it gets fresh streams, and we
  // want the protocol layer to see the latest pair without holding stale
  // references.
  const port = {
    get readable() {
      return sp.readable;
    },
    get writable() {
      return sp.writable;
    },
    close: () => sp.close(),
    async reopenAtBaud(baudRate: number): Promise<void> {
      await sp.close();
      // Brief settle so the OS releases the device handle before re-open.
      await new Promise((resolve) => setTimeout(resolve, 100));
      await sp.open({ baudRate, bufferSize: 16_384 });
      // Same DTR-reset settle as the initial open.
      await new Promise((resolve) => setTimeout(resolve, 1500));
    },
  } as Port;
  if (typeof sp.addEventListener === 'function') {
    port.addEventListener = (ev, cb) => sp.addEventListener!(ev, cb);
  }
  if (typeof sp.removeEventListener === 'function') {
    port.removeEventListener = (ev, cb) => sp.removeEventListener!(ev, cb);
  }
  return port;
}
