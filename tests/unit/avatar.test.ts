import { describe, it, expect } from 'vitest';
import { calcAvatarTargetSize, isAvatarDataUrl, MAX_AVATAR_LENGTH } from '$lib/utils/avatar';

describe('calcAvatarTargetSize', () => {
  it('does not upscale smaller images', () => {
    expect(calcAvatarTargetSize(100, 100, 256)).toEqual({ tw: 100, th: 100 });
  });

  it('scales a wide image down to fit the max', () => {
    expect(calcAvatarTargetSize(1000, 500, 256)).toEqual({ tw: 256, th: 128 });
  });

  it('scales a tall image down to fit the max', () => {
    expect(calcAvatarTargetSize(500, 1000, 256)).toEqual({ tw: 128, th: 256 });
  });

  it('handles square images exactly at max', () => {
    expect(calcAvatarTargetSize(256, 256, 256)).toEqual({ tw: 256, th: 256 });
  });

  it('returns 0/0 for invalid input', () => {
    expect(calcAvatarTargetSize(0, 100, 256)).toEqual({ tw: 0, th: 0 });
    expect(calcAvatarTargetSize(100, 0, 256)).toEqual({ tw: 0, th: 0 });
    expect(calcAvatarTargetSize(100, 100, 0)).toEqual({ tw: 0, th: 0 });
    expect(calcAvatarTargetSize(-1, 100, 256)).toEqual({ tw: 0, th: 0 });
  });
});

describe('isAvatarDataUrl', () => {
  it('accepts jpeg / png / webp data URLs', () => {
    expect(isAvatarDataUrl('data:image/jpeg;base64,ABC123=')).toBe(true);
    expect(isAvatarDataUrl('data:image/png;base64,ABC123=')).toBe(true);
    expect(isAvatarDataUrl('data:image/webp;base64,ABC123=')).toBe(true);
  });

  it('rejects other mime types', () => {
    expect(isAvatarDataUrl('data:image/gif;base64,ABC')).toBe(false);
    expect(isAvatarDataUrl('data:image/svg+xml;base64,ABC')).toBe(false);
    expect(isAvatarDataUrl('data:text/plain;base64,ABC')).toBe(false);
  });

  it('rejects plain URLs and arbitrary strings', () => {
    expect(isAvatarDataUrl('https://example.com/x.jpg')).toBe(false);
    expect(isAvatarDataUrl('')).toBe(false);
    expect(isAvatarDataUrl('javascript:alert(1)')).toBe(false);
    expect(isAvatarDataUrl('data:image/jpeg;base64,')).toBe(false);
  });

  it('rejects payloads with characters outside base64 alphabet', () => {
    expect(isAvatarDataUrl('data:image/jpeg;base64,!!@@')).toBe(false);
  });
});

describe('MAX_AVATAR_LENGTH', () => {
  it('is large enough for a typical 256x256 JPEG @0.85', () => {
    /* A 256x256 JPEG @0.85 is typically 20-40 KB → ~30-55 KB base64. The cap
     * sits well above this so quality doesn't have to be cranked down. */
    expect(MAX_AVATAR_LENGTH).toBeGreaterThan(80_000);
    expect(MAX_AVATAR_LENGTH).toBeLessThan(500_000);
  });
});
