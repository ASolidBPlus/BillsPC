export { convert } from './convert.js';
export { isRefusal } from './types/refusal.js';
export type { Gen12Pokemon, Gen12DVs, Gen12StatExp, SourceGen } from './types/source.js';
export type { Gen3Intermediate, ConvertMetadata } from './types/target.js';
export type { ConvertOptions, RNG, RngFactory } from './types/options.js';
export type { Refusal, RefusalReason } from './types/refusal.js';

// Sprint 2 wire-format packer/unpacker.
export { packBoxed, unpackBoxed, BOXED_SIZE } from './pack/boxed.js';
export { packParty, PARTY_SIZE } from './pack/party.js';
export type { DecodeError, DecodeErrorReason } from './pack/decodeError.js';
export { isDecodeError } from './pack/decodeError.js';

// Sprint 3a save reader.
export { parseSave, detectFormat, isSaveError } from './sav/index.js';
export type {
  SaveContents,
  SaveError,
  SaveErrorReason,
  SaveFormat,
  TrainerInfo,
  SaveSource,
} from './types/sav.js';

// Sprint 6b — Gen 1/2 source save delete (transferred-mon eviction).
export { deleteMonGen1 } from './sav/gen1/writer.js';
export type { Gen1DeleteRef, Gen1WriterFormat } from './sav/gen1/writer.js';
export { deleteMonGen2 } from './sav/gen2/writer.js';
export type { Gen2DeleteRef, Gen2WriterFormat } from './sav/gen2/writer.js';
export { encodeMonGen2 } from './sav/gen2/encoder.js';
export type { EncodedGen2Mon } from './sav/gen2/encoder.js';

// Sprint 6a Gen 3 destination save reader/inject.
export {
  parseGen3Save,
  isGen3SaveError,
  injectIntoSave,
  isGen3InjectError,
  detectGen3,
  familyOf,
  gen3GameLabel,
  decodeGen3BoxName,
  decodeGen3BoxNames,
  decodeGen3String,
  decodeSlotSummary,
  PCBUFFER_BOX_COUNT,
  PCBUFFER_SLOTS_PER_BOX,
  PCBUFFER_SLOT_BYTES,
} from './sav/gen3/index.js';
export type {
  Gen3SaveContents,
  Gen3SaveError,
  Gen3SaveErrorReason,
  Gen3TrainerInfo,
  Gen3InjectError,
  Gen3InjectErrorReason,
  InjectTarget,
  BoxedSlot,
  PcBoxBlock,
  SlotSummary,
  ActiveSlot,
  SaveFormat3,
  Gen3Family,
  SaveSink,
  SaveSinkOptions,
  SaveSinkProgress,
} from './sav/gen3/index.js';

// Sprint 7a — Web Serial GBxCart RW adapter (read-only Cart Mode).
export {
  CartError,
  isCartError,
  GbxCartSource,
  openGbxCartSource,
  FileUploadSource,
  detectProtocol,
  parseCartHeader,
  InsidegadgetsProtocol,
  FlashgbxProtocol,
  // S9 — DmgMapper hierarchy.
  detectMapper,
  detectMapperOrThrow,
  UNSUPPORTED_CART_MESSAGE,
} from './cart/index.js';
export type { DmgMapper, MapperBus, CartWriteCmd } from './cart/index.js';

// Sprint 7b — cart-write side: composable sinks + JEDEC Flash helper +
// transfer-matrix planner. The SaveSink interface itself is re-exported
// above from `gen3/saveSink.ts` (which re-exports from the canonical
// family-agnostic `sav/saveSink.ts` per AMEND-S7b-13).
export { GbxCartSink } from './cart/sinks/gbxCartSink.js';
export { WriteAndVerifySink, WriteVerifyError } from './cart/sinks/writeAndVerifySink.js';
export type { WriteVerifyMismatch } from './cart/sinks/types.js';
export {
  JedecFlash,
  agbFlashSectorPlan,
  AGB_FLASH_SECTOR_BYTES,
  AGB_FLASH_BANK_BYTES,
  AGB_FLASH_BANK_COUNT,
  AGB_FLASH_TOTAL_BYTES,
} from './cart/protocol/agbFlash.js';
export { planTransfer, TransferMatrixRefusal } from './transfer/matrix.js';
export type {
  TransferPlan,
  TransferConversion,
  TransferMatrixRefusalReason,
} from './transfer/matrix.js';
export {
  composeSourceWrite,
  composeDestinationWrite,
  isComposeError,
} from './transfer/composeWrite.js';
export type { StagedMonRefGen12, StagedMonRefGen3, ComposeError } from './transfer/composeWrite.js';
export type {
  Port,
  CartIdentity,
  FirmwareInfo,
  ProtocolVariant,
  CartReadOptions,
  CartWriteOptions,
  CartErrorReason,
  CartProtocol,
  CartFamily,
  CartHeader,
} from './cart/index.js';
export type {
  SaveSource as CartSaveSource,
  SaveSourceOptions as CartSaveSourceOptions,
  SaveSourceProgress as CartSaveSourceProgress,
  SaveSourceMetadata as CartSaveSourceMetadata,
  SaveSourceResult as CartSaveSourceResult,
} from './cart/index.js';
export { setCartDebug, isCartDebug } from './cart/index.js';
