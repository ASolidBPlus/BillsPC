/**
 * Stream-framing primitive tests.
 */
import { describe, it, expect } from 'vitest';
import { FrameReader, concat, writeAll } from '../framing.js';
import { CartError } from '../../types.js';
import { makeMockPort, bytes, ascii } from './mockPort.js';

describe('FrameReader', () => {
  it('readExactly returns exactly N bytes from a single chunk', async () => {
    const port = makeMockPort();
    port.enqueueRx(bytes(1, 2, 3, 4, 5));
    const reader = new FrameReader(port);
    const out = await reader.readExactly(3);
    expect(Array.from(out)).toEqual([1, 2, 3]);
    const out2 = await reader.readExactly(2);
    expect(Array.from(out2)).toEqual([4, 5]);
    reader.release();
  });

  it('readExactly accumulates across multiple chunks (partial-read coalesce)', async () => {
    const port = makeMockPort();
    port.enqueueRx(bytes(0x10, 0x11), bytes(0x12, 0x13, 0x14));
    const reader = new FrameReader(port);
    const out = await reader.readExactly(5);
    expect(Array.from(out)).toEqual([0x10, 0x11, 0x12, 0x13, 0x14]);
    reader.release();
  });

  it('readExactly with signal aborted before any read throws CANCELLED', async () => {
    const port = makeMockPort();
    const reader = new FrameReader(port);
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(reader.readExactly(2, { signal: ctrl.signal })).rejects.toThrow(CartError);
    reader.release();
  });

  it('readUntil consumes up to and including the sentinel', async () => {
    const port = makeMockPort();
    port.enqueueRx(ascii('hello\nworld'));
    const reader = new FrameReader(port);
    const line = await reader.readUntil(0x0a);
    expect(String.fromCharCode(...line)).toBe('hello');
    const rest = await reader.readExactly(5);
    expect(String.fromCharCode(...rest)).toBe('world');
    reader.release();
  });

  it('readExactly times out when no bytes arrive', async () => {
    const port = makeMockPort();
    const reader = new FrameReader(port);
    await expect(reader.readExactly(1, { timeoutMs: 25 })).rejects.toThrow(CartError);
    reader.release();
  });

  it('writeAll writes the entire buffer through the port writable', async () => {
    const port = makeMockPort();
    await writeAll(port, ascii('GBxCart'));
    expect(port.txAscii()).toBe('GBxCart');
  });

  it('concat joins two Uint8Arrays', () => {
    expect(Array.from(concat(bytes(1, 2), bytes(3, 4, 5)))).toEqual([1, 2, 3, 4, 5]);
    expect(Array.from(concat(bytes(), bytes(9)))).toEqual([9]);
    expect(Array.from(concat(bytes(9), bytes()))).toEqual([9]);
  });
});
