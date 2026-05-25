import { describe, it, expect } from 'vitest';
import { calcAvatarTargetSize, isAvatarDataUrl, MAX_AVATAR_LENGTH } from '$lib/utils/avatar';

describe('calcAvatarTargetSize', () => {
  it.each([
    ['no upscale of smaller image', 100, 100, 256, { tw: 100, th: 100 }],
    ['wide image scaled down', 1000, 500, 256, { tw: 256, th: 128 }],
    ['tall image scaled down', 500, 1000, 256, { tw: 128, th: 256 }],
    ['square exactly at max', 256, 256, 256, { tw: 256, th: 256 }],
    ['zero width', 0, 100, 256, { tw: 0, th: 0 }],
    ['zero height', 100, 0, 256, { tw: 0, th: 0 }],
    ['zero max', 100, 100, 0, { tw: 0, th: 0 }],
    ['negative width', -1, 100, 256, { tw: 0, th: 0 }]
  ])('%s', (_label, w, h, max, expected) => {
    expect(calcAvatarTargetSize(w, h, max)).toEqual(expected);
  });
});

describe('isAvatarDataUrl', () => {
  /* Real magic-number prefixes (base64-encoded) — anything else is a
   * forged payload that we now reject. */
  const PNG_B64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAACklEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=';
  const JPEG_B64 =
    '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAr/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AL+AB//Z';
  const WEBP_B64 = 'UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=';

  it.each([
    [`data:image/png;base64,${PNG_B64}`, 'png with PNG signature'],
    [`data:image/jpeg;base64,${JPEG_B64}`, 'jpeg with JPEG signature'],
    [`data:image/webp;base64,${WEBP_B64}`, 'webp with WEBP signature']
  ])('accepts: %s (%s)', (input) => {
    expect(isAvatarDataUrl(input)).toBe(true);
  });

  it.each([
    /* Mismatched magic-numbers — would have passed the old regex-only check. */
    [`data:image/png;base64,${JPEG_B64}`, 'jpeg payload declared as png'],
    [`data:image/jpeg;base64,${PNG_B64}`, 'png payload declared as jpeg'],
    [`data:image/webp;base64,${PNG_B64}`, 'png payload declared as webp'],
    /* Junk b64 that passes the envelope regex but fails magic-number. */
    ['data:image/jpeg;base64,ABC123=', 'junk jpeg'],
    ['data:image/png;base64,ABC123=', 'junk png'],
    /* Unsupported MIME types. */
    ['data:image/gif;base64,ABC', 'gif mime'],
    ['data:image/svg+xml;base64,ABC', 'svg mime'],
    ['data:text/plain;base64,ABC', 'text/plain mime'],
    /* Non-data-URL strings. */
    ['https://example.com/x.jpg', 'http url'],
    ['', 'empty string'],
    ['javascript:alert(1)', 'javascript scheme'],
    ['data:image/jpeg;base64,', 'empty payload'],
    ['data:image/jpeg;base64,!!@@', 'invalid base64 chars']
  ])('rejects: %s (%s)', (input) => {
    expect(isAvatarDataUrl(input)).toBe(false);
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
