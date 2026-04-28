/**
 * S7b cart-write sinks. The `BackupSink` decorator lives in `web/` (it's
 * browser-shaped — uses `showSaveFilePicker`); these two are core-shaped
 * (no DOM).
 */

export { GbxCartSink } from './gbxCartSink.js';
export type { GbxCartSinkDeps } from './gbxCartSink.js';
export {
  WriteAndVerifySink,
  WriteVerifyError,
  isWriteVerifyError,
} from './writeAndVerifySink.js';
export type { WriteAndVerifySinkDeps } from './writeAndVerifySink.js';
export type { WriteVerifyMismatch } from './types.js';
