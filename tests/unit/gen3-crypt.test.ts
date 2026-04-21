import { describe, expect, it } from 'vitest';
import {
  decryptBlock,
  deriveKey,
  encryptBlock,
  ENCRYPTED_BLOCK_SIZE,
  makeOtFull,
  xorCrypt48,
} from '../../core/src/pack/gen3Crypt.js';

describe('gen3Crypt', () => {
  it('XOR encrypt then decrypt is identity (round-trip)', () => {
    const plain = new Uint8Array(ENCRYPTED_BLOCK_SIZE);
    for (let i = 0; i < plain.length; i++) plain[i] = (i * 31 + 7) & 0xff;
    const pid = 0xdeadbeef;
    const otFull = makeOtFull(0x1234, 0x5678);
    const encrypted = encryptBlock(plain, pid, otFull);
    expect(encrypted).not.toEqual(plain);
    const decrypted = decryptBlock(encrypted, pid, otFull);
    expect(decrypted).toEqual(plain);
  });

  it('xorCrypt48 is self-inverse in place', () => {
    const block = new Uint8Array(ENCRYPTED_BLOCK_SIZE);
    for (let i = 0; i < block.length; i++) block[i] = i;
    const original = block.slice();
    const key = 0xa5a5a5a5;
    xorCrypt48(block, key);
    expect(block).not.toEqual(original);
    xorCrypt48(block, key);
    expect(block).toEqual(original);
  });

  it('deriveKey = pid ^ otFull (xorCrypt48 >>> 0 normalises downstream)', () => {
    // deriveKey returns a JS-bitwise XOR; signed int32 is fine — xorCrypt48
    // applies `>>> 0` on every word write. Assert via `>>> 0`-normalised compare.
    expect(deriveKey(0xffffffff, 0x00000000) >>> 0).toBe(0xffffffff);
    expect(deriveKey(0xffffffff, 0xffffffff) >>> 0).toBe(0);
    expect(deriveKey(0x80000000, 0x00000000) >>> 0).toBe(0x80000000);
    expect(deriveKey(0xdeadbeef, 0xcafebabe) >>> 0).toBe((0xdeadbeef ^ 0xcafebabe) >>> 0);
  });

  it('makeOtFull packs SID into high 16 bits, TID into low 16', () => {
    expect(makeOtFull(0x1234, 0x5678)).toBe(0x56781234);
    expect(makeOtFull(0xffff, 0xffff)).toBe(0xffffffff);
    expect(makeOtFull(0x0000, 0x0000)).toBe(0);
  });

  it('xorCrypt48 throws on wrong-size block', () => {
    expect(() => xorCrypt48(new Uint8Array(47), 0)).toThrow(RangeError);
    expect(() => xorCrypt48(new Uint8Array(49), 0)).toThrow(RangeError);
  });

  it('XOR with key=0 is a no-op', () => {
    const plain = new Uint8Array(ENCRYPTED_BLOCK_SIZE);
    for (let i = 0; i < plain.length; i++) plain[i] = i ^ 0x55;
    const out = encryptBlock(plain, 0, 0);
    expect(out).toEqual(plain);
  });
});
