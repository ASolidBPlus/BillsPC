/**
 * S7a — controller-level cart-connect happy path.
 *
 * Wires `createController` with a `cartReadDeps` whose `requestPort`
 * returns a mocked port scripted to act like a stock GBxCart RW with a
 * Crystal cart inserted. Confirms the controller transitions through
 *   idle → cart-progress → loaded
 * and that the box browser ends up rendered on the source pane.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createController, DEFAULT_DEPS, handleCartConnect, type ControllerDeps } from '../ui.js';
import type { Port } from '@pokeportal/core';

const HERE = dirname(fileURLToPath(import.meta.url));
const CRYSTAL = resolve(HERE, '../../../tests/fixtures/saves/demo-crystal.sav');

const NINTENDO_LOGO = [
  0xce, 0xed, 0x66, 0x66, 0xcc, 0x0d, 0x00, 0x0b, 0x03, 0x73, 0x00, 0x83, 0x00, 0x0c, 0x00, 0x0d,
  0x00, 0x08, 0x11, 0x1f, 0x88, 0x89, 0x00, 0x0e, 0xdc, 0xcc, 0x6e, 0xe6, 0xdd, 0xdd, 0xd9, 0x99,
  0xbb, 0xbb, 0x67, 0x63, 0x6e, 0x0e, 0xec, 0xcc, 0xdd, 0xdc, 0x99, 0x9f, 0xbb, 0xb9, 0x33, 0x3e,
];

function gbcHeader(title: string): Uint8Array {
  const buf = new Uint8Array(0x150);
  for (let i = 0; i < NINTENDO_LOGO.length; i++) buf[0x104 + i] = NINTENDO_LOGO[i]!;
  for (let i = 0; i < Math.min(title.length, 16); i++) buf[0x134 + i] = title.charCodeAt(i);
  buf[0x143] = 0xc0;
  buf[0x149] = 3;
  return buf;
}

function makeStubPort(sram: Uint8Array): Port {
  // Build the script of bytes the firmware will reply with as the
  // protocol layer issues commands. The order is:
  //  1. detectProtocol → 'V' → single byte fw version (e.g. 26 = R26)
  //  2. setMode('gb') → no reply
  //  3. readRom(0, 0x150) → header bytes (336 = 0x150 → padded to next 64
  //     multiple = 384)
  //  4. setRamEnabled(true) → no reply
  //  5. setBank(0..3) → no reply (bank loop for 32 KB)
  //  6. readSram('gbc', 8192) × 4 banks → 8KB chunks of the 32KB sram
  //  7. setRamEnabled(false) → no reply
  const fwByte = new Uint8Array([26]);
  // detect.ts now ALWAYS probes LK after a sane V byte. For a pure-stock
  // mock we satisfy the LK probe with a single size-byte = 0 (≠ 8 means
  // "no LK extension") so detect falls through to InsidegadgetsProtocol.
  const lkProbeFallthrough = new Uint8Array([0]);
  const header = gbcHeader('PM_CRYSTAL');
  // bulkRead reads in firmware-block-aligned chunks. 0x150 = 336, rounded
  // up to next 64 boundary is 384. We pad header to 384 with zeroes.
  const headerPadded = new Uint8Array(384);
  headerPadded.set(header, 0);
  const bank8k = (i: number): Uint8Array => sram.subarray(i * 8192, (i + 1) * 8192);

  const queue: Uint8Array[] = [
    fwByte,
    lkProbeFallthrough,
    headerPadded,
    bank8k(0),
    bank8k(1),
    bank8k(2),
    bank8k(3),
  ];

  let pendingResolve: ((v: { value?: Uint8Array; done?: boolean }) => void) | null = null;

  const readable = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (queue.length > 0) {
        controller.enqueue(queue.shift()!);
        return;
      }
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
    write() {
      // discard host writes — script is fixed
    },
  });

  return {
    readable,
    writable,
    async close(): Promise<void> {
      if (pendingResolve) pendingResolve({ done: true });
    },
  };
}

describe('cart connect flow (controller)', () => {
  let root: HTMLElement;
  beforeEach(() => {
    document.body.replaceChildren();
    root = document.createElement('div');
    document.body.appendChild(root);
  });

  it('happy path: connect → read → render box browser', async () => {
    const sram = new Uint8Array(readFileSync(CRYSTAL));
    const deps: ControllerDeps = {
      ...DEFAULT_DEPS,
      cartAvailable: true,
      cartReadDeps: { requestPort: async () => makeStubPort(sram) },
    };
    const controller = createController(root, deps);
    controller.dispatch({ type: 'mode_changed', mode: 'cart' });
    await handleCartConnect('source', controller.state(), (a) => controller.dispatch(a), deps);
    const state = controller.state();
    expect(state.kind).toBe('loaded');
    if (state.kind !== 'loaded') return;
    expect(state.save.format).toBe('CRYSTAL');
    expect(state.cartConnection?.variant).toBe('insidegadgets');
    // The box browser renders on the source pane after connect.
    expect(root.querySelector('.box-browser, .source-pane .pane-label')).not.toBeNull();
  });

  it('cart_connect_failed when the port request rejects', async () => {
    const deps: ControllerDeps = {
      ...DEFAULT_DEPS,
      cartAvailable: true,
      cartReadDeps: {
        requestPort: async () => {
          throw new Error('user cancelled the port picker');
        },
      },
    };
    const controller = createController(root, deps);
    controller.dispatch({ type: 'mode_changed', mode: 'cart' });
    await handleCartConnect('source', controller.state(), (a) => controller.dispatch(a), deps);
    const state = controller.state();
    expect(state.cartReadError).toBeDefined();
    expect(state.cartReadError!.message).toContain('user cancelled');
  });

  it('cart_connect_failed when no cartReadDeps are configured', async () => {
    const deps: ControllerDeps = { ...DEFAULT_DEPS, cartAvailable: true };
    (deps as { cartReadDeps?: unknown }).cartReadDeps = undefined;
    const controller = createController(root, deps);
    controller.dispatch({ type: 'mode_changed', mode: 'cart' });
    await handleCartConnect('source', controller.state(), (a) => controller.dispatch(a), deps);
    const state = controller.state();
    expect(state.cartReadError?.reason).toBe('PORT_OPEN_FAILED');
  });
});
