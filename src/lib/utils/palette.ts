/**
 * Visual palette — orthogonal to light/dark theme.
 *
 *  - `bauhaus` (default): primary-color blocks, hard borders, off-white
 *    canvas — the original Episode look.
 *  - `ecobrutalism`: raw concrete surfaces, deep moss greens, hard
 *    geometry, subtle weathered texture.
 *  - `artnouveau`: ivory parchment canvas, antique gold + copper +
 *    peacock teal, soft curves, sinuous-line ornaments.
 *
 * The choice is persisted in `localStorage` under `episode.palette` and
 * applied as a `data-palette` attribute on `<html>`. The boot script in
 * +layout.svelte reads it before hydration to avoid a flash of the
 * default palette.
 */
export type PaletteChoice = 'bauhaus' | 'ecobrutalism' | 'artnouveau';

export const PALETTES: readonly PaletteChoice[] = [
  'bauhaus',
  'ecobrutalism',
  'artnouveau'
] as const;
export const DEFAULT_PALETTE: PaletteChoice = 'bauhaus';

export function isPalette(value: unknown): value is PaletteChoice {
  return value === 'bauhaus' || value === 'ecobrutalism' || value === 'artnouveau';
}

export function readStoredPalette(storage: Storage | null = null): PaletteChoice {
  const s = storage ?? (typeof localStorage === 'undefined' ? null : localStorage);
  if (!s) return DEFAULT_PALETTE;
  const raw = s.getItem('episode.palette');
  return isPalette(raw) ? raw : DEFAULT_PALETTE;
}

export function applyPalette(palette: PaletteChoice, doc: Document = document): void {
  doc.documentElement.dataset.palette = palette;
}
