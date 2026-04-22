/**
 * Wire-level debug logger for the GBxCart protocol layer.
 *
 * Default OFF. Toggle from web/src/ui.ts based on a URL param or
 * localStorage flag, OR programmatically from a test. When ON, every
 * TX/RX byte is logged to console.log with a tight hex dump + timestamp
 * relative to enable-time.
 *
 * Tag any high-level protocol event with `dlog('label', ...args)`.
 */

let enabled = false;
let baseMs = 0;

export function setCartDebug(on: boolean): void {
  enabled = on;
  if (on) baseMs = Date.now();
}

export function isCartDebug(): boolean {
  return enabled;
}

function ts(): string {
  const d = Date.now() - baseMs;
  const s = (d / 1000).toFixed(3);
  return `+${s.padStart(8, ' ')}s`;
}

function hex(bytes: Uint8Array, max = 64): string {
  const n = Math.min(bytes.length, max);
  let s = '';
  for (let i = 0; i < n; i++) {
    if (i > 0 && i % 16 === 0) s += '\n              ';
    s += bytes[i]!.toString(16).padStart(2, '0') + ' ';
  }
  if (bytes.length > max) s += `… (+${bytes.length - max} more)`;
  return s.trimEnd();
}

function ascii(bytes: Uint8Array, max = 32): string {
  const n = Math.min(bytes.length, max);
  let s = '';
  for (let i = 0; i < n; i++) {
    const b = bytes[i]!;
    s += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.';
  }
  return s;
}

export function dlogTx(bytes: Uint8Array): void {
  if (!enabled) return;
  console.log(
    `%c[gbxcart] ${ts()} TX (${bytes.length}b) %c"${ascii(bytes)}"\n              ${hex(bytes)}`,
    'color:#5878a8;font-weight:bold',
    'color:#888',
  );
}

export function dlogRx(bytes: Uint8Array): void {
  if (!enabled) return;
  console.log(
    `%c[gbxcart] ${ts()} RX (${bytes.length}b) %c"${ascii(bytes)}"\n              ${hex(bytes)}`,
    'color:#58a058;font-weight:bold',
    'color:#888',
  );
}

export function dlog(label: string, ...args: unknown[]): void {
  if (!enabled) return;
  console.log(`%c[gbxcart] ${ts()} ${label}`, 'color:#d8a838;font-weight:bold', ...args);
}
