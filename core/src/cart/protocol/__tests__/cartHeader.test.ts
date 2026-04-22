import { describe, it, expect } from 'vitest';
import { parseCartHeader } from '../cartHeader.js';

const NINTENDO_LOGO = [
  0xce, 0xed, 0x66, 0x66, 0xcc, 0x0d, 0x00, 0x0b, 0x03, 0x73, 0x00, 0x83, 0x00, 0x0c, 0x00, 0x0d,
  0x00, 0x08, 0x11, 0x1f, 0x88, 0x89, 0x00, 0x0e, 0xdc, 0xcc, 0x6e, 0xe6, 0xdd, 0xdd, 0xd9, 0x99,
  0xbb, 0xbb, 0x67, 0x63, 0x6e, 0x0e, 0xec, 0xcc, 0xdd, 0xdc, 0x99, 0x9f, 0xbb, 0xb9, 0x33, 0x3e,
];

function makeGbHeader(opts: {
  title: string;
  cgb?: number;
  cartType?: number;
  ramSize?: number;
}): Uint8Array {
  const buf = new Uint8Array(0x150);
  // Logo at 0x104..0x133
  for (let i = 0; i < NINTENDO_LOGO.length; i++) buf[0x104 + i] = NINTENDO_LOGO[i]!;
  // Title at 0x134..0x143
  for (let i = 0; i < Math.min(opts.title.length, 16); i++) {
    buf[0x134 + i] = opts.title.charCodeAt(i);
  }
  buf[0x143] = opts.cgb ?? 0;
  buf[0x147] = opts.cartType ?? 0x13;
  buf[0x149] = opts.ramSize ?? 3;
  return buf;
}

function makeGbaHeader(opts: { title: string; gameCode: string }): Uint8Array {
  const buf = new Uint8Array(0xc0);
  for (let i = 0; i < Math.min(opts.title.length, 12); i++)
    buf[0xa0 + i] = opts.title.charCodeAt(i);
  for (let i = 0; i < 4; i++) buf[0xac + i] = opts.gameCode.charCodeAt(i);
  return buf;
}

describe('parseCartHeader', () => {
  it('returns null for inputs shorter than 0x150', () => {
    expect(parseCartHeader(new Uint8Array(0x100))).toBeNull();
  });

  it('parses a Pokemon Red header as gb / 32 KB', () => {
    const h = parseCartHeader(makeGbHeader({ title: 'POKEMON RED', cgb: 0, ramSize: 3 }));
    expect(h).not.toBeNull();
    expect(h!.kind).toBe('gb');
    expect(h!.title).toBe('POKEMON RED');
    expect(h!.ramSizeBytes).toBe(32 * 1024);
  });

  it('parses a Crystal header as gbc / 32 KB', () => {
    const h = parseCartHeader(makeGbHeader({ title: 'PM_CRYSTAL', cgb: 0xc0, ramSize: 3 }));
    expect(h).not.toBeNull();
    expect(h!.kind).toBe('gbc');
    expect(h!.title).toBe('PM_CRYSTAL');
    expect(h!.ramSizeBytes).toBe(32 * 1024);
  });

  it('parses an Emerald-style GBA header (no Nintendo logo, AGB game code)', () => {
    const buf = new Uint8Array(0x150);
    const h = makeGbaHeader({ title: 'POKEMON EMER', gameCode: 'BPEE' });
    buf.set(h, 0);
    const out = parseCartHeader(buf);
    expect(out).not.toBeNull();
    expect(out!.kind).toBe('gba');
    expect(out!.title).toBe('POKEMON EMER');
    expect(out!.ramSizeBytes).toBe(128 * 1024);
  });

  it('returns null when neither logo nor a printable game code is present', () => {
    const buf = new Uint8Array(0x150);
    // logo bytes intentionally zeroed; gameCode bytes also zero
    expect(parseCartHeader(buf)).toBeNull();
  });

  it('classifies cgb=0x80 as gbc as well', () => {
    const h = parseCartHeader(makeGbHeader({ title: 'PM_CRYSTAL', cgb: 0x80 }));
    expect(h!.kind).toBe('gbc');
  });

  it('respects the ram-size-byte → byte-count mapping', () => {
    expect(parseCartHeader(makeGbHeader({ title: 'X', ramSize: 0 }))!.ramSizeBytes).toBe(0);
    expect(parseCartHeader(makeGbHeader({ title: 'X', ramSize: 2 }))!.ramSizeBytes).toBe(8 * 1024);
    expect(parseCartHeader(makeGbHeader({ title: 'X', ramSize: 4 }))!.ramSizeBytes).toBe(
      128 * 1024,
    );
  });

  it('strips trailing nulls + whitespace from the title', () => {
    const h = parseCartHeader(makeGbHeader({ title: 'POKEMON' }));
    expect(h!.title).toBe('POKEMON');
  });
});
