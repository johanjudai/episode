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

const AVATAR_DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

export function isAvatarDataUrl(s: string): boolean {
  return AVATAR_DATA_URL.test(s);
}

/** Maximum size of the base64 payload accepted by the server. ~150 KB allows
 *  for 256×256 JPEG quality 0.85 plus headroom. */
export const MAX_AVATAR_LENGTH = 200_000;
