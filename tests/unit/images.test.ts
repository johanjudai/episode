import { describe, expect, it } from 'vitest';
import { posterUrl, stillUrl } from '$lib/utils/images';

describe('posterUrl', () => {
  it('builds a TMDB poster URL for a canonical path', () => {
    expect(posterUrl('/abc123.jpg')).toBe('https://image.tmdb.org/t/p/w342/abc123.jpg');
  });

  it('honours the requested size variant', () => {
    expect(posterUrl('/x.jpg', 'w185')).toBe('https://image.tmdb.org/t/p/w185/x.jpg');
    expect(posterUrl('/x.jpg', 'w500')).toBe('https://image.tmdb.org/t/p/w500/x.jpg');
  });

  it('accepts standard image extensions', () => {
    expect(posterUrl('/x.png')).toMatch(/x\.png$/);
    expect(posterUrl('/x.webp')).toMatch(/x\.webp$/);
    expect(posterUrl('/x.jpeg')).toMatch(/x\.jpeg$/);
  });

  it('returns null for empty / nullish input', () => {
    expect(posterUrl(null)).toBeNull();
    expect(posterUrl(undefined)).toBeNull();
    expect(posterUrl('')).toBeNull();
  });

  it('rejects paths that would let CSS escape its quote', () => {
    /* Each of these would close the `url('…')` argument and inject something
     * if we naively interpolated the path. The whitelist refuses them. */
    expect(posterUrl(`/foo.jpg'); background-image: url(http://evil`)).toBeNull();
    expect(posterUrl(`/foo.jpg"`)).toBeNull();
    expect(posterUrl(`/foo.jpg)`)).toBeNull();
    expect(posterUrl(`/foo.jpg ;`)).toBeNull();
    expect(posterUrl(`javascript:alert(1)`)).toBeNull();
    expect(posterUrl(`http://evil.com/x.jpg`)).toBeNull();
    expect(posterUrl(`//evil.com/x.jpg`)).toBeNull();
    expect(posterUrl(`/../etc/passwd`)).toBeNull();
  });

  it('rejects unknown extensions even on otherwise-valid paths', () => {
    expect(posterUrl('/abc.html')).toBeNull();
    expect(posterUrl('/abc')).toBeNull();
  });
});

describe('stillUrl', () => {
  it('builds an episode still URL with the default size', () => {
    expect(stillUrl('/still.jpg')).toBe('https://image.tmdb.org/t/p/w500/still.jpg');
  });

  it('applies the same whitelist as posterUrl', () => {
    expect(stillUrl(`/x.jpg'`)).toBeNull();
    expect(stillUrl(null)).toBeNull();
  });
});
