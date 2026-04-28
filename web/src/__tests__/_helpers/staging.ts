/**
 * Shared test fixtures + fake StagingStore for the v2 staging integration tests.
 *
 * Three new test files (v2-source-stage-flow, v2-transfer-dest-flow,
 * v2-clear-transfer, v2-transfer-full-banner, v2-placement-collision) need
 * the same plumbing: a fake or real StagingStore, a Gen 1/2 SaveContents,
 * and a Gen 3 SaveContents. Centralised here to keep each test file focused
 * on its assertions.
 */

import type {
  Gen12Pokemon,
  Gen3SaveContents,
  SaveContents,
} from '@pokeportal/core';
import type {
  StagedPlacement,
  StagedSlot,
  StagingSnapshot,
} from '../../cart/stagingStore.types.js';
import type { StagingStore } from '../../cart/stagingStore.js';
import { deriveSourceRefKey } from '../../cart/stagingStore.js';

/* ------------------------------------------------------------------ */
/* Gen 1/2 fixture                                                    */
/* ------------------------------------------------------------------ */

function fillBytes(s: string, len: number): Uint8Array {
  const out = new Uint8Array(len).fill(0x50);
  for (let i = 0; i < s.length && i < len; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0x41 && c <= 0x5a) out[i] = 0x80 + (c - 0x41);
  }
  return out;
}

export function makeGen2Mon(opts: {
  speciesGen2Id: number;
  nickname?: string;
  level?: number;
}): Gen12Pokemon {
  return {
    sourceGen: 2,
    speciesGen2Id: opts.speciesGen2Id,
    level: opts.level ?? 50,
    exp: 125_000,
    dvs: { atk: 15, def: 15, spe: 15, special: 15 },
    statExp: { hp: 0, atk: 0, def: 0, spe: 0, special: 0 },
    moves: [33, 0, 0, 0],
    pp: [35, 0, 0, 0],
    ppUps: [0, 0, 0, 0],
    heldItemGen2Id: null,
    friendship: 70,
    pokerusByte: 0,
    otNameBytes: fillBytes('JOEL', 11),
    tid: 12345,
    nicknameBytes: fillBytes(opts.nickname ?? 'X', 11),
    language: 2,
  };
}

/**
 * Build a Crystal-format SaveContents with `mons` placed in box 0 starting
 * at slot 0. Other boxes empty. No party.
 */
export function makeGen2SaveWithBox0(mons: ReadonlyArray<Gen12Pokemon>): SaveContents {
  const box0 = mons.slice();
  const boxes = Array.from({ length: 14 }, (_, i) => (i === 0 ? box0 : []));
  return {
    format: 'CRYSTAL',
    trainer: { name: 'JOEL', nameBytes: fillBytes('JOEL', 11), tid: 12345 },
    party: [],
    boxes,
    warnings: [],
  };
}

/* ------------------------------------------------------------------ */
/* Gen 3 fixture                                                      */
/* ------------------------------------------------------------------ */

type Gen3Slot =
  | { kind: 'empty' }
  | { kind: 'filled'; bytes: Uint8Array; species: number };

/**
 * Build an Emerald-format Gen3SaveContents with all 14 boxes empty.
 * `occupiedDestSlots` lets a fixture pre-fill specific (boxIndex, slot)
 * pairs so dest-cursor advance tests can assert skip-occupied behaviour.
 */
export function makeGen3Save(
  occupiedDestSlots: ReadonlyArray<{ boxIndex: number; slot: number }> = [],
): Gen3SaveContents {
  const boxes: Gen3Slot[][] = Array.from({ length: 14 }, () =>
    Array.from({ length: 30 }, (): Gen3Slot => ({ kind: 'empty' })),
  );
  for (const { boxIndex, slot } of occupiedDestSlots) {
    boxes[boxIndex]![slot] = { kind: 'filled', bytes: new Uint8Array(80), species: 1 };
  }
  return {
    kind: 'gen3_save',
    format: 'EMERALD',
    family: 'EMERALD',
    bytes: new Uint8Array(131072),
    active: {
      slotIndex: 0,
      slotOffset: 0,
      saveIndex: 1,
      sectorOrder: new Map(),
      checksumsValid: true,
      singleSlot: false,
      inactiveSlotOffset: 0xe000,
    },
    trainer: {
      otNameBytes: new Uint8Array(7),
      tid: 99999,
      sid: 0,
      gameCode: 0xbcf3_4f1f,
    },
    pc: {
      currentBox: 0,
      boxes,
      boxNamesRaw: new Uint8Array(126),
      wallpapersRaw: new Uint8Array(14),
    },
    boxNames: Array.from({ length: 14 }, (_, i) => `BOX ${i + 1}`),
    warnings: [],
  };
}

/* ------------------------------------------------------------------ */
/* StagedSlot factory + empty 30-array                                */
/* ------------------------------------------------------------------ */

export function emptySlots(): Array<StagedSlot | null> {
  return Array.from({ length: 30 }, () => null);
}

/**
 * Build a fully-populated StagedSlot for tests. `placement` is `null` by
 * default; pass `withPlacement: true` for a default placement at box 1
 * slot 6 (matches the v2-transfer-box-render fixture style).
 */
export function makeSlot(
  idx: number,
  opts: {
    speciesId?: number;
    sourceBoxIndex?: number;
    sourceSlot?: number;
    placement?: StagedPlacement | null;
    sourceCartLabel?: string;
    sourceTid?: number;
  } = {},
): StagedSlot {
  const sourceCartLabel = opts.sourceCartLabel ?? 'POKEMON CRYSTAL';
  const sourceTid = opts.sourceTid ?? 12345;
  const sourceBoxIndex = opts.sourceBoxIndex ?? 0;
  const sourceSlot = opts.sourceSlot ?? idx;
  const sourceRef = { bucket: 'box' as const, boxIndex: sourceBoxIndex, slot: sourceSlot };
  return {
    idx,
    pkBytes: new Uint8Array([0xfe, idx]),
    speciesId: opts.speciesId ?? 158 + idx,
    nicknameDisplay: `MON${idx}`,
    sourceCartLabel,
    sourceTid,
    sourceFamily: 'gen2',
    sourceOtName: 'JOEL',
    sourceRef,
    sourceRefKey: deriveSourceRefKey(sourceCartLabel, sourceTid, sourceRef),
    stagedAt: `2026-04-25T10:00:00.${idx}Z`,
    placement: opts.placement ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* FakeStagingStore — duck-typed StagingStore for spy-driven tests    */
/* ------------------------------------------------------------------ */

/**
 * Minimal in-memory StagingStore stand-in. Implements the slot-addressed
 * surface the v2 action handlers actually call: `nextEmptySlot`,
 * `isStaged`, `placeAt`, `setPlacement`, `clear`, `getSlot`,
 * `getAllSlots`, `removeAt`. Other methods (subscribe, multi-tab, etc.)
 * are stubbed enough to satisfy the structural cast at the call site.
 *
 * Tests cast via `as unknown as StagingStore` — vitest can `vi.spyOn`
 * any of the public methods on this instance.
 */
export class FakeStagingStore {
  private slots: Array<StagedSlot | null> = Array.from({ length: 30 }, () => null);
  pendingMigrationOverflow = 0;

  /** Seed slots without going through `placeAt` (no spy capture). */
  seed(slots: ReadonlyArray<StagedSlot | null>): void {
    this.slots = slots.slice() as Array<StagedSlot | null>;
  }

  getAllSlots(): StagingSnapshot {
    return this.slots.slice();
  }

  getSlot(idx: number): StagedSlot | null {
    return this.slots[idx] ?? null;
  }

  nextEmptySlot(): number | null {
    for (let i = 0; i < 30; i++) if (this.slots[i] === null) return i;
    return null;
  }

  isStaged(sourceRefKey: string): boolean {
    for (const s of this.slots) {
      if (s !== null && s.sourceRefKey === sourceRefKey) return true;
    }
    return false;
  }

  async placeAt(idx: number, mon: Omit<StagedSlot, 'idx' | 'placement'>): Promise<void> {
    if (this.slots[idx] !== null) {
      throw new Error(`FakeStagingStore.placeAt: slot ${idx} occupied`);
    }
    const next = this.slots.slice();
    next[idx] = { ...mon, idx, placement: null };
    this.slots = next;
  }

  async setPlacement(idx: number, placement: StagedPlacement | null): Promise<void> {
    const cur = this.slots[idx];
    if (!cur) throw new Error(`FakeStagingStore.setPlacement: slot ${idx} empty`);
    const next = this.slots.slice();
    next[idx] = { ...cur, placement };
    this.slots = next;
  }

  async removeAt(idx: number): Promise<void> {
    const next = this.slots.slice();
    next[idx] = null;
    this.slots = next;
  }

  /** S8v2.3 — flips the source-committed flag on an occupied slot.
   *  Mirrors `StagingStore.setSourceCommitted`. */
  async setSourceCommitted(idx: number, value: boolean): Promise<void> {
    const cur = this.slots[idx];
    if (!cur) throw new Error(`FakeStagingStore.setSourceCommitted: slot ${idx} empty`);
    const next = this.slots.slice();
    next[idx] = { ...cur, sourceCommitted: value };
    this.slots = next;
  }

  async clear(): Promise<void> {
    this.slots = Array.from({ length: 30 }, () => null);
  }

  // The remaining surface is unused by v2Actions but referenced by the
  // controller-init path — stubbed so the structural cast holds.
  subscribe(): () => void {
    return () => undefined;
  }
  subscribeSlots(): () => void {
    return () => undefined;
  }
  subscribeMultiTab(): () => void {
    return () => undefined;
  }
  occupiedSlots(): ReadonlyArray<StagedSlot> {
    return this.slots.filter((s): s is StagedSlot => s !== null);
  }
  close(): void {
    /* no-op */
  }

  /** Test helper — cast through `unknown` to hand to a deps slot. */
  asStore(): StagingStore {
    return this as unknown as StagingStore;
  }
}
