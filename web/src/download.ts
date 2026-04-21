/**
 * Minimal blob-download helper. Per PLAN_EVAL "Risks" #8: ALWAYS
 * revoke the Object URL after the click handler runs. Setting the
 * revocation in a 1-second timeout is the commonly-recommended pattern
 * (immediate revoke can race the navigation).
 */
const REVOKE_DELAY_MS = 1000;

export function blobDownload(
  filename: string,
  bytes: Uint8Array,
  mime = 'application/octet-stream',
): void {
  // Copy into a fresh ArrayBuffer-backed view so the Blob constructor
  // accepts it under TS lib.dom strict typings (ArrayBufferLike vs
  // ArrayBuffer divergence in lib.dom 2024).
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const blob = new Blob([ab], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}
