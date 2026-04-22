/**
 * S7a — `'serial' in navigator` capability probe + the Cart Mode toggle
 * disabled-state behaviour when Web Serial is missing.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isWebSerialAvailable, isSaveFilePickerAvailable } from '../cart/browserCompat.js';

describe('isWebSerialAvailable', () => {
  let original: PropertyDescriptor | undefined;
  beforeEach(() => {
    original = Object.getOwnPropertyDescriptor(navigator, 'serial');
  });
  afterEach(() => {
    if (original) {
      Object.defineProperty(navigator, 'serial', original);
    } else {
      delete (navigator as unknown as { serial?: unknown }).serial;
    }
  });

  it('returns false in jsdom (no serial in navigator)', () => {
    delete (navigator as unknown as { serial?: unknown }).serial;
    expect(isWebSerialAvailable()).toBe(false);
  });

  it('returns true when navigator.serial is present', () => {
    Object.defineProperty(navigator, 'serial', { value: {}, configurable: true });
    expect(isWebSerialAvailable()).toBe(true);
  });
});

describe('isSaveFilePickerAvailable', () => {
  it('returns false in jsdom (no showSaveFilePicker)', () => {
    expect(isSaveFilePickerAvailable()).toBe(false);
  });
});
