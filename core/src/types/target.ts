/**
 * Gen 3 intermediate struct (HANDOFF §7). This is the S1 deliverable —
 * the conversion core produces this typed object; S2 will pack/encrypt/checksum
 * it into the on-cart 64/80-byte format.
 */

export interface Gen3Intermediate {
  readonly species: number; // Gen 3 dex number
  readonly nickname: Uint8Array; // Gen 3 encoding, 0xFF-terminated, ≤10 chars payload
  readonly otName: Uint8Array; // Gen 3 encoding, 0xFF-terminated, ≤7 chars payload
  readonly otGender: 0 | 1;
  readonly tid: number;
  readonly sid: number;
  readonly pid: number;
  readonly ivs: {
    readonly hp: number;
    readonly atk: number;
    readonly def: number;
    readonly spa: number;
    readonly spd: number;
    readonly spe: number;
  };
  readonly evs: {
    readonly hp: number;
    readonly atk: number;
    readonly def: number;
    readonly spa: number;
    readonly spd: number;
    readonly spe: number;
  };
  readonly nature: number; // 0..24
  readonly abilitySlot: 0;
  readonly moves: readonly [number, number, number, number];
  readonly pp: readonly [number, number, number, number];
  readonly ppUps: readonly [number, number, number, number];
  readonly heldItem: number;
  readonly friendship: number;
  readonly exp: number;
  readonly level: number;
  readonly pokerus: number;
  readonly contestStats: {
    readonly cool: 0;
    readonly beauty: 0;
    readonly cute: 0;
    readonly clever: 0;
    readonly tough: 0;
    readonly sheen: 0;
  };
  readonly ribbons: readonly [];
  readonly markings: 0;
  readonly metLocation: 146; // Four Island (0x92)
  readonly metLevel: 0; // PKHeX expects 0 for hatched eggs (HANDOFF §4.8 was wrong with 5)
  readonly metGame: 'FireRed';
  readonly originGame: 'FireRed';
  readonly fatefulEncounter: false;
  readonly isEgg: false;
  readonly language: number;
  readonly _meta: ConvertMetadata;
}

export interface ConvertMetadata {
  readonly pidSearchIterations: number;
  readonly evScalingApplied: boolean;
  readonly evRemainderDistributed: number;
  readonly zeroDvOverridesApplied: readonly ('hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe')[];
  readonly unownLetterConstrained: boolean;
  readonly warnings: readonly string[];
}
