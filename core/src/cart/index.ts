/**
 * Public surface for the Sprint 7a cart layer.
 *
 * Importers should pull everything from here — the per-file paths under
 * `protocol/` are implementation detail.
 */

export { CartError, isCartError } from './types.js';
export type {
  Port,
  CartIdentity,
  FirmwareInfo,
  ProtocolVariant,
  CartReadOptions,
  CartWriteOptions,
  CartErrorReason,
} from './types.js';

export { GbxCartSource, openGbxCartSource } from './gbxCartSource.js';
export type { GbxCartSourceDeps } from './gbxCartSource.js';
export { FileUploadSource } from './fileUploadSource.js';
export type {
  SaveSource,
  SaveSourceOptions,
  SaveSourceProgress,
  SaveSourceMetadata,
  SaveSourceResult,
} from './saveSource.js';

export {
  detectProtocol,
  parseCartHeader,
  InsidegadgetsProtocol,
  FlashgbxProtocol,
} from './protocol/index.js';
export type { CartProtocol, CartFamily, CartHeader } from './protocol/index.js';

export { setCartDebug, isCartDebug } from './protocol/debug.js';
