const IMAGE_BASE = 'https://image.tmdb.org/t/p';

/* Whitelist for TMDB image paths. These strings flow into inline
 * `background-image: url('...')` attributes; a malicious or compromised
 * upstream returning `/x.jpg'); …` could otherwise break out of the CSS
 * string. Keeping the regex narrow (slash, alphanumerics, common image
 * extension) blocks every meaningful injection vector. */
const TMDB_IMAGE_PATH = /^\/[A-Za-z0-9._-]+\.(jpg|jpeg|png|webp|svg)$/i;

export function posterUrl(
  path: string | null | undefined,
  size: 'w185' | 'w342' | 'w500' = 'w342'
): string | null {
  if (typeof path !== 'string' || !TMDB_IMAGE_PATH.test(path)) return null;
  return `${IMAGE_BASE}/${size}${path}`;
}

/** Builds a TMDB still URL for an episode (16:9 episode thumbnail). */
export function stillUrl(
  path: string | null | undefined,
  size: 'w300' | 'w500' = 'w500'
): string | null {
  if (typeof path !== 'string' || !TMDB_IMAGE_PATH.test(path)) return null;
  return `${IMAGE_BASE}/${size}${path}`;
}
