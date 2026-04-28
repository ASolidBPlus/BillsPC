/**
 * Backward-compat re-export shim. Per AMEND-S7b-13 the SaveSink interface
 * is family-agnostic and lives at `core/src/sav/saveSink.ts`. S6a callers
 * (and the public `gen3/index.ts` barrel) keep importing it from here.
 *
 * S7b added: `GbxCartSink` (DMG / AGB cart write), `WriteAndVerifySink`
 * (composable post-write verify), `BackupSink` (mandatory pre-write
 * backup). All implement the same `SaveSink` interface — see the parent
 * file for the contract.
 */

export type { SaveSink, SaveSinkOptions, SaveSinkProgress } from '../saveSink.js';
