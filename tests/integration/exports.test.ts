import { describe, it, expect } from 'vitest';
import * as publicApi from '../../core/src/index.js';

/**
 * PLAN_EVAL A14: snapshot the public surface. A failing test here means
 * either a new export was added intentionally (update the snapshot) or a
 * rename silently broke consumer code.
 */
describe('public API surface', () => {
  it('exports only the documented members', () => {
    const keys = Object.keys(publicApi).sort();
    // Types don't appear at runtime; only values show up here. S2 added
    // the wire-format packer/unpacker exports.
    // S6a additions: Gen 3 save reader/inject (parseGen3Save,
    // injectIntoSave, etc.). The snapshot is intentionally exhaustive so
    // a rename or accidental drop surfaces here as a single failure.
    expect(keys).toEqual([
      'AGB_FLASH_BANK_BYTES',
      'AGB_FLASH_BANK_COUNT',
      'AGB_FLASH_SECTOR_BYTES',
      'AGB_FLASH_TOTAL_BYTES',
      'BOXED_SIZE',
      // S7a — Web Serial cart adapter (read-only Cart Mode):
      'CartError',
      'FileUploadSource',
      'FlashgbxProtocol',
      'GbxCartSink',
      'GbxCartSource',
      'InsidegadgetsProtocol',
      'JedecFlash',
      'PARTY_SIZE',
      'PCBUFFER_BOX_COUNT',
      'PCBUFFER_SLOTS_PER_BOX',
      'PCBUFFER_SLOT_BYTES',
      'TransferMatrixRefusal',
      'WriteAndVerifySink',
      'WriteVerifyError',
      'agbFlashSectorPlan',
      'composeDestinationWrite',
      'composeSourceWrite',
      'convert',
      'decodeGen3BoxName',
      'decodeGen3BoxNames',
      'decodeGen3String',
      'decodeSlotSummary',
      'deleteMonGen1',
      'deleteMonGen2',
      'detectFormat',
      'detectGen3',
      'detectProtocol',
      'encodeMonGen2',
      'familyOf',
      'gen3GameLabel',
      'injectIntoSave',
      'isCartDebug',
      'isCartError',
      'isComposeError',
      'isDecodeError',
      'isGen3InjectError',
      'isGen3SaveError',
      'isRefusal',
      'isSaveError',
      'openGbxCartSource',
      'packBoxed',
      'packParty',
      'parseCartHeader',
      'parseGen3Save',
      'parseSave',
      'planTransfer',
      'setCartDebug',
      'unpackBoxed',
    ]);
  });

  it('convert is a function', () => {
    expect(typeof publicApi.convert).toBe('function');
  });

  it('isRefusal is a function', () => {
    expect(typeof publicApi.isRefusal).toBe('function');
  });
});
