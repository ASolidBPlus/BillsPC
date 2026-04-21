/**
 * Public entry point for the Sprint 3a save reader.
 *
 * `parseSave(bytes)` returns either a populated `SaveContents` or a
 * tagged `SaveError`. The parser never throws — all error modes are
 * value-returning. Use `isSaveError(x)` to narrow.
 */

import { detectFormat, structuralProbe } from './format.js';
import { parseGen1 } from './gen1/parser.js';
import { parseCrystal } from './gen2/parser.js';
import { triage } from './lengthTriage.js';
import type { SaveContents, SaveError } from '../types/sav.js';

export type { SaveContents, SaveError, SaveFormat, TrainerInfo, SaveSource } from '../types/sav.js';
export { isSaveError } from '../types/sav.js';

function err(reason: SaveError['reason'], message: string): SaveError {
  return { kind: 'save_error', reason, message };
}

export function parseSave(bytes: Uint8Array): SaveContents | SaveError {
  if (!(bytes instanceof Uint8Array)) {
    return err('CORRUPTED', 'parseSave: input is not a Uint8Array');
  }

  const triageResult = triage(bytes, structuralProbe);
  if (triageResult.kind === 'fail') {
    if (triageResult.reason === 'TOO_SHORT') {
      return err('TOO_SHORT', triageResult.message);
    }
    return err('UNRECOGNIZED_FORMAT', triageResult.message);
  }

  const sram = triageResult.bytes;
  const detection = detectFormat(sram);
  if (!detection) {
    return err(
      'UNRECOGNIZED_FORMAT',
      'No supported Gen 1/2 save signature detected (length OK but structure does not match RB/Yellow/GS/Crystal).',
    );
  }

  if (detection.format === 'GS') {
    return err('UNSUPPORTED_VARIANT', 'Pokemon Gold/Silver support is deferred to a later sprint.');
  }
  if (detection.format === 'RBY-YELLOW') {
    return err('UNSUPPORTED_VARIANT', 'Pokemon Yellow support is deferred to a later sprint.');
  }

  let parsed: SaveContents;
  try {
    if (detection.format === 'CRYSTAL') {
      parsed = parseCrystal(sram);
    } else {
      // RBY-RED (and RBY-BLUE, which is byte-identical for our purposes).
      parsed = parseGen1(sram, detection.format);
    }
  } catch (e) {
    return err('CORRUPTED', `parser threw: ${(e as Error).message}`);
  }

  // Merge triage warnings (e.g. emulator_trailer_stripped) and detection
  // warnings (checksum_mismatch) into the SaveContents warnings list.
  const detectionWarnings: string[] = [];
  if (detection.checksumValid === false) {
    detectionWarnings.push('checksum_mismatch');
  }
  if (triageResult.warnings.length === 0 && detectionWarnings.length === 0) {
    return parsed;
  }
  return {
    ...parsed,
    warnings: [...triageResult.warnings, ...detectionWarnings, ...parsed.warnings],
  };
}

export { detectFormat };
