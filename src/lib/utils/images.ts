const IMAGE_BASE = 'https://image.tmdb.org/t/p';

export function posterUrl(
  path: string | null | undefined,
  size: 'w185' | 'w342' | 'w500' = 'w342'
): string | null {
  if (!path) return null;
  return `${IMAGE_BASE}/${size}${path}`;
}
