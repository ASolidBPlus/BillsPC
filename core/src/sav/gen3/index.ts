/**
 * Public API for the Sprint 6a Gen 3 destination-save module.
 *
 * S6a covers parse + inject. S6b will add a GBxCart RW Web Serial
 * source/sink atop these primitives.
 */

export {
  parseGen3Save,
  isGen3SaveError,
  type Gen3SaveContents,
  type Gen3SaveError,
  type Gen3SaveErrorReason,
  type Gen3TrainerInfo,
  type ActiveSlot,
  type BoxedSlot,
  type PcBoxBlock,
} from './parseSave.js';

export {
  injectIntoSave,
  isGen3InjectError,
  type Gen3InjectError,
  type Gen3InjectErrorReason,
  type InjectTarget,
} from './injectMon.js';

// S10 — manual cart-patch primitives.
export { patchGen3Slot, isGen3PatchError } from './patchMon.js';
export type { Gen3MonEdits, Gen3PatchError, Gen3PatchErrorReason } from './patchMon.js';
export { patchSlotInSave } from './patchSave.js';
export {
  validatePid,
  parsePid,
  validateTid,
  validateSid,
  validateIv,
  validateOtName,
  type Validation,
  type ValidationOk,
  type ValidationFail,
} from './editValidate.js';

export {
  detectGen3,
  familyOf,
  gen3GameLabel,
  type SaveFormat3,
  type Gen3Family,
  PCBUFFER_BOX_COUNT,
  PCBUFFER_SLOTS_PER_BOX,
  PCBUFFER_SLOT_BYTES,
  SAVE_BYTES_FULL,
  SAVE_BYTES_SINGLE,
} from './format.js';

export { decodeGen3BoxName, decodeGen3BoxNames, decodeGen3String } from './charmap3.js';
export { decodeSlotSummary, type SlotSummary } from './boxes.js';

export type { SaveSink, SaveSinkOptions, SaveSinkProgress } from './saveSink.js';
