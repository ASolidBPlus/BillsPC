/**
 * Game Boy / Game Boy Advance cart-header parser.
 *
 * GB/GBC: header at 0x100..0x14F. The Nintendo logo bytes at
 *   0x104..0x133 are the canonical "is this a GB cart" probe — if they
 *   match the stock logo, it's a GB cart; if they're all 0xFF or 0x00
 *   it's almost certainly a GBA cart (its logo lives at 0x04..0xA0
 *   and the GBA header starts at 0xA0).
 *
 * GBA: header at 0xA0..0xBC. We probe for the 4-char game code at
 *   0xAC..0xAF starting with 'A' (any AGB cart) and the title at
 *   0xA0..0xAB.
 *
 * Returns null on truncated input or a totally-corrupted header. The
 * caller decides what to do with `kind` (typically: 'gb'|'gbc' →
 * `parseSave`, 'gba' → `parseGen3Save`).
 */

export interface CartHeader {
  readonly kind: 'gb' | 'gbc' | 'gba';
  readonly title: string;
  readonly cartType: number;
  readonly ramSizeBytes: number;
}

const NINTENDO_LOGO = Uint8Array.of(
  0xce,
  0xed,
  0x66,
  0x66,
  0xcc,
  0x0d,
  0x00,
  0x0b,
  0x03,
  0x73,
  0x00,
  0x83,
  0x00,
  0x0c,
  0x00,
  0x0d,
  0x00,
  0x08,
  0x11,
  0x1f,
  0x88,
  0x89,
  0x00,
  0x0e,
  0xdc,
  0xcc,
  0x6e,
  0xe6,
  0xdd,
  0xdd,
  0xd9,
  0x99,
  0xbb,
  0xbb,
  0x67,
  0x63,
  0x6e,
  0x0e,
  0xec,
  0xcc,
  0xdd,
  0xdc,
  0x99,
  0x9f,
  0xbb,
  0xb9,
  0x33,
  0x3e,
);

/** GB SRAM size byte at header offset 0x149. 0=none, 1=2KB, 2=8KB,
 *  3=32KB, 4=128KB, 5=64KB. */
function gbRamSize(byte: number): number {
  switch (byte) {
    case 0:
      return 0;
    case 1:
      return 2 * 1024;
    case 2:
      return 8 * 1024;
    case 3:
      return 32 * 1024;
    case 4:
      return 128 * 1024;
    case 5:
      return 64 * 1024;
    default:
      return 32 * 1024;
  }
}

export function parseCartHeader(bytes: Uint8Array): CartHeader | null {
  if (bytes.length < 0x150) return null;
  // GB / GBC probe — Nintendo logo at 0x104..0x133.
  let logoMatches = true;
  for (let i = 0; i < NINTENDO_LOGO.length; i++) {
    if (bytes[0x104 + i] !== NINTENDO_LOGO[i]) {
      logoMatches = false;
      break;
    }
  }
  if (logoMatches) {
    const title = decodeTitle(bytes, 0x134, 16);
    const cgbFlag = bytes[0x143] ?? 0;
    const cartType = bytes[0x147] ?? 0;
    const ramByte = bytes[0x149] ?? 0;
    const kind: 'gb' | 'gbc' = cgbFlag === 0x80 || cgbFlag === 0xc0 ? 'gbc' : 'gb';
    return { kind, title, cartType, ramSizeBytes: gbRamSize(ramByte) };
  }
  // GBA probe — title at 0xA0..0xAB, game code at 0xAC..0xAF (4 chars
  // typically starting with 'A' or 'B' for retail releases).
  if (bytes.length < 0xc0) return null;
  const code0 = bytes[0xac] ?? 0;
  const code1 = bytes[0xad] ?? 0;
  const code2 = bytes[0xae] ?? 0;
  const code3 = bytes[0xaf] ?? 0;
  const codeChars = [code0, code1, code2, code3].every((b) => b >= 0x20 && b <= 0x7e);
  if (!codeChars) return null;
  const title = decodeTitle(bytes, 0xa0, 12);
  // GBA carts are 32 KB / 64 KB / 128 KB SRAM (Pokemon Gen 3 = 128 KB).
  return { kind: 'gba', title, cartType: 0, ramSizeBytes: 128 * 1024 };
}

function decodeTitle(bytes: Uint8Array, off: number, len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) {
    const b = bytes[off + i] ?? 0;
    if (b === 0x00) break;
    if (b >= 0x20 && b <= 0x7e) s += String.fromCharCode(b);
  }
  return s.trim();
}
