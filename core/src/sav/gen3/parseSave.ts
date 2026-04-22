/**
 * Public Gen 3 save parser entry point.
 *
 * Returns a populated `Gen3SaveContents` or a tagged `Gen3SaveError`.
 * Never throws — all error modes are value-returning to keep parity with
 * the S3a Gen 1/2 parser.
 *
 * Per PLAN_EVAL R10: `bytes` is a defensively-copied Uint8Array. The
 * caller can mutate the source buffer freely without invalidating the
 * parsed view.
 */

import { readU16LE, readU32LE } from '../../pack/leBytes.js';
import {
  PCBUFFER_BOX_COUNT,
  PCBUFFER_BOX_NAMES_OFFSET,
  PCBUFFER_BOX_NAME_BYTES,
  SAVE_BYTES_FULL,
  SAVE_BYTES_SINGLE,
  detectGen3,
  familyOf,
  type Gen3Family,
  type SaveFormat3,
} from './format.js';
import { findActiveSlot, type ActiveSlot } from './sectors.js';
import { assemblePcBuffer, parsePcBuffer, type BoxedSlot, type PcBoxBlock } from './boxes.js';
import { decodeGen3BoxNames } from './charmap3.js';

export type Gen3SaveErrorReason = 'TOO_SHORT' | 'UNRECOGNIZED_FORMAT' | 'CORRUPTED';

export interface Gen3SaveError {
  readonly kind: 'gen3_save_error';
  readonly reason: Gen3SaveErrorReason;
  readonly message: string;
}

export interface Gen3TrainerInfo {
  readonly otNameBytes: Uint8Array; // 7 bytes (Gen 3 charmap)
  readonly tid: number;
  readonly sid: number;
  readonly gameCode: number;
}

export interface Gen3SaveContents {
  readonly kind: 'gen3_save';
  readonly format: SaveFormat3;
  readonly family: Gen3Family;
  readonly bytes: Uint8Array; // FULL save buffer (128 KB or 64 KB), defensively copied
  readonly active: ActiveSlot;
  readonly trainer: Gen3TrainerInfo;
  readonly pc: PcBoxBlock;
  readonly boxNames: readonly string[]; // 14 entries, decoded via charmap3
  readonly warnings: readonly string[];
}

const TRAINER_OT_NAME_OFFSET = 0x00;
const TRAINER_OT_NAME_BYTES = 7;
// Gen 3 trainer block: byte 0x08 is gender, 0x0A..0x0E is the full Trainer ID (TID lo, SID hi),
// per PKHeX SAV3.cs.
const TRAINER_TID_OFFSET = 0x0a;
// SID is the high u16 of the trainer-ID u32 (TID is the low u16).

function err(reason: Gen3SaveErrorReason, message: string): Gen3SaveError {
  return { kind: 'gen3_save_error', reason, message };
}

export function isGen3SaveError(x: Gen3SaveContents | Gen3SaveError): x is Gen3SaveError {
  return (x as { kind?: string }).kind === 'gen3_save_error';
}

export function parseGen3Save(input: Uint8Array): Gen3SaveContents | Gen3SaveError {
  if (!(input instanceof Uint8Array)) {
    return err('CORRUPTED', 'parseGen3Save: input is not a Uint8Array');
  }
  if (input.length !== SAVE_BYTES_FULL && input.length !== SAVE_BYTES_SINGLE) {
    if (input.length < SAVE_BYTES_SINGLE) {
      return err(
        'TOO_SHORT',
        `Gen 3 save must be ${SAVE_BYTES_SINGLE} or ${SAVE_BYTES_FULL} bytes; got ${input.length}`,
      );
    }
    return err(
      'UNRECOGNIZED_FORMAT',
      `Gen 3 save must be ${SAVE_BYTES_SINGLE} or ${SAVE_BYTES_FULL} bytes; got ${input.length}`,
    );
  }
  const format = detectGen3(input);
  if (format === null) {
    return err('UNRECOGNIZED_FORMAT', 'Gen 3 save signature not found (no valid sector_id 0).');
  }
  // Defensive copy so the caller can mutate the source buffer freely.
  const bytes = new Uint8Array(input);
  let active: ActiveSlot;
  try {
    active = findActiveSlot(bytes);
  } catch (e) {
    return err('UNRECOGNIZED_FORMAT', `findActiveSlot failed: ${(e as Error).message}`);
  }
  const warnings: string[] = [];
  if (active.singleSlot) {
    warnings.push('gen3_single_slot_save');
  }
  if (!active.checksumsValid) {
    warnings.push('gen3_checksum_mismatch');
  }
  const sec0 = active.sectorOrder.get(0);
  if (!sec0) {
    return err('UNRECOGNIZED_FORMAT', 'Active slot is missing sector 0 (TrainerInfo).');
  }
  // Trainer info — read OT name, TID/SID, gameCode from sec 0 body
  const sec0Off = sec0.diskOffset;
  const otNameBytes = bytes.slice(
    sec0Off + TRAINER_OT_NAME_OFFSET,
    sec0Off + TRAINER_OT_NAME_OFFSET + TRAINER_OT_NAME_BYTES,
  );
  const trainerIdU32 = readU32LE(bytes, sec0Off + TRAINER_TID_OFFSET);
  const tid = trainerIdU32 & 0xffff;
  const sid = (trainerIdU32 >>> 16) & 0xffff;
  const gameCode = readU32LE(bytes, sec0Off + 0xac);
  const trainer: Gen3TrainerInfo = { otNameBytes, tid, sid, gameCode };

  let pc: PcBoxBlock;
  try {
    const pcBuffer = assemblePcBuffer(bytes, active);
    pc = parsePcBuffer(pcBuffer);
  } catch (e) {
    return err('CORRUPTED', `PC buffer parse failed: ${(e as Error).message}`);
  }
  const boxNames = decodeGen3BoxNames(pc.boxNamesRaw);
  if (boxNames.length !== PCBUFFER_BOX_COUNT) {
    return err('CORRUPTED', `decoded ${boxNames.length} box names; expected ${PCBUFFER_BOX_COUNT}`);
  }

  return {
    kind: 'gen3_save',
    format,
    family: familyOf(format),
    bytes,
    active,
    trainer,
    pc,
    boxNames,
    warnings,
  };
}

// Re-exports
void readU16LE;
void PCBUFFER_BOX_NAMES_OFFSET;
void PCBUFFER_BOX_NAME_BYTES;
export type { ActiveSlot, BoxedSlot, PcBoxBlock };
