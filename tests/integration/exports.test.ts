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
    expect(keys).toEqual([
      'BOXED_SIZE',
      'PARTY_SIZE',
      'convert',
      'detectFormat',
      'isDecodeError',
      'isRefusal',
      'isSaveError',
      'packBoxed',
      'packParty',
      'parseSave',
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
