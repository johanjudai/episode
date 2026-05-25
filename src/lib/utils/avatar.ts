/** Pure helpers for avatar handling. */

export function calcAvatarTargetSize(
  width: number,
  height: number,
  max: number
): { tw: number; th: number } {
  if (width <= 0 || height <= 0 || max <= 0) return { tw: 0, th: 0 };
  const ratio = Math.min(max / width, max / height, 1);
  return { tw: Math.round(width * ratio), th: Math.round(height * ratio) };
}

const AVATAR_DATA_URL = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/;

/* Magic-number signatures for the three formats we accept. Validating
 * the envelope alone (mime type + base64 charset) lets through
 * arbitrary base64 that *looks* like an image but isn't — useless on
 * its own (we render it via CSS `background-image: url(...)`, which
 * is inert), but checking the signature here keeps junk out of the
 * SQLite blob and gives the UI a fail-fast 400 if a third-party tool
 * forges an avatar payload. */
const MAGIC = {
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  jpeg: [0xff, 0xd8, 0xff],
  /* RIFF....WEBP — bytes 0-3 + 8-11. */
  webpHead: [0x52, 0x49, 0x46, 0x46],
  webpTail: [0x57, 0x45, 0x42, 0x50]
};

function matchesPrefix(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (bytes[offset + i] !== sig[i]) return false;
  return true;
}

function decodeBase64Prefix(b64: string, byteCount: number): Uint8Array | null {
  /* We only need the first few bytes for the signature check. Decode
   * just enough base64 to cover them — each 4 base64 chars yield 3
   * bytes, so ceil(byteCount/3)*4 chars suffice. atob is faster than
   * a buffer-wide decode and avoids holding the full payload twice. */
  const charsNeeded = Math.min(b64.length, Math.ceil(byteCount / 3) * 4);
  const slice = b64.slice(0, charsNeeded);
  try {
    const bin = atob(slice);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export function isAvatarDataUrl(s: string): boolean {
  const m = AVATAR_DATA_URL.exec(s);
  if (!m) return false;
  const format = m[1] as 'png' | 'jpeg' | 'webp';
  const bytes = decodeBase64Prefix(m[2], 12);
  if (!bytes) return false;
  if (format === 'png') return matchesPrefix(bytes, MAGIC.png);
  if (format === 'jpeg') return matchesPrefix(bytes, MAGIC.jpeg);
  /* webp: RIFF at offset 0, "WEBP" at offset 8. */
  return matchesPrefix(bytes, MAGIC.webpHead) && matchesPrefix(bytes, MAGIC.webpTail, 8);
}

/** Maximum size of the base64 payload accepted by the server. ~150 KB allows
 *  for 256×256 JPEG quality 0.85 plus headroom. */
export const MAX_AVATAR_LENGTH = 200_000;
