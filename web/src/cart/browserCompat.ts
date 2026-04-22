/**
 * Web Serial / File System Access API capability probes + the
 * fallback-explainer dialog that fires the first time a Firefox/Safari
 * user clicks the disabled `[Cart Mode]` tab.
 */

interface NavigatorWithSerial extends Navigator {
  serial?: unknown;
}

interface WindowWithPicker extends Window {
  showSaveFilePicker?: unknown;
}

export function isWebSerialAvailable(): boolean {
  if (typeof navigator === 'undefined') return false;
  return 'serial' in (navigator as NavigatorWithSerial);
}

export function isSaveFilePickerAvailable(): boolean {
  if (typeof globalThis === 'undefined') return false;
  return typeof (globalThis as unknown as WindowWithPicker).showSaveFilePicker === 'function';
}

export const FALLBACK_TOOLTIP =
  'Cart Mode requires a Chromium-based browser (Chrome, Edge, Opera, Brave). Use Upload Mode instead.';
