import { describe, it, expect } from 'vitest';
import {
  normalizeVersion,
  compareSemver,
  isNewerVersion,
  dueForCheck,
  parseLatestRelease,
  checkForUpdate,
  UPDATE_CHECK_INTERVAL_MS
} from '$lib/update';

describe('update helpers', () => {
  describe('normalizeVersion', () => {
    it.each([
      ['v0.2.0', '0.2.0'],
      ['0.2.0', '0.2.0'],
      ['V1.0.0', '1.0.0'],
      ['1.2.3-beta.1', '1.2.3'],
      ['1.2.3+build5', '1.2.3'],
      ['  v2.0.0 ', '2.0.0']
    ])('%s → %s', (input, expected) => {
      expect(normalizeVersion(input)).toBe(expected);
    });
  });

  describe('compareSemver', () => {
    it.each([
      ['0.2.0', '0.1.0', 1],
      ['0.1.0', '0.2.0', -1],
      ['1.0.0', '1.0.0', 0],
      ['v1.2.0', '1.2', 0],
      ['1.2.3', '1.2.10', -1],
      ['2.0.0', '1.9.9', 1],
      ['0.0.0-dev', '0.1.0', -1]
    ])('compareSemver(%s, %s) = %s', (a, b, expected) => {
      expect(compareSemver(a, b)).toBe(expected);
    });
  });

  describe('isNewerVersion', () => {
    it('true only when strictly greater', () => {
      expect(isNewerVersion('v0.2.0', '0.1.0')).toBe(true);
      expect(isNewerVersion('0.1.0', '0.1.0')).toBe(false);
      expect(isNewerVersion('0.1.0', '0.2.0')).toBe(false);
    });
  });

  describe('dueForCheck', () => {
    const now = 1_000_000_000_000;
    it('due when never checked', () => {
      expect(dueForCheck(null, now)).toBe(true);
      expect(dueForCheck(NaN, now)).toBe(true);
    });
    it('not due within the interval', () => {
      expect(dueForCheck(now - 1000, now)).toBe(false);
    });
    it('due once the interval has elapsed', () => {
      expect(dueForCheck(now - UPDATE_CHECK_INTERVAL_MS, now)).toBe(true);
    });
  });

  describe('parseLatestRelease', () => {
    const apkAsset = {
      name: 'episode-v0.2.0.apk',
      browser_download_url: 'https://github.com/x/y/releases/download/v0.2.0/episode-v0.2.0.apk',
      content_type: 'application/vnd.android.package-archive',
      size: 12345
    };

    it('parses a release with an APK asset', () => {
      const info = parseLatestRelease({
        tag_name: 'v0.2.0',
        html_url: 'https://github.com/x/y/releases/tag/v0.2.0',
        body: 'notes',
        assets: [apkAsset]
      });
      expect(info).toEqual({
        tag: 'v0.2.0',
        version: '0.2.0',
        apkUrl: apkAsset.browser_download_url,
        sizeBytes: 12345,
        releaseUrl: 'https://github.com/x/y/releases/tag/v0.2.0',
        notes: 'notes'
      });
    });

    it('falls back to a .apk-by-name asset when content-type is generic', () => {
      const info = parseLatestRelease({
        tag_name: 'v0.3.0',
        assets: [
          { name: 'notes.txt', browser_download_url: 'u1', content_type: 'text/plain' },
          {
            name: 'episode-v0.3.0.apk',
            browser_download_url: 'u2',
            content_type: 'application/octet-stream'
          }
        ]
      });
      expect(info?.apkUrl).toBe('u2');
    });

    it.each([
      ['draft', { tag_name: 'v1', draft: true, assets: [apkAsset] }],
      ['prerelease', { tag_name: 'v1', prerelease: true, assets: [apkAsset] }],
      ['no tag', { assets: [apkAsset] }],
      [
        'no apk asset',
        { tag_name: 'v1', assets: [{ name: 'src.zip', browser_download_url: 'z' }] }
      ],
      ['null', null]
    ])('returns null for %s', (_label, release) => {
      expect(parseLatestRelease(release)).toBeNull();
    });
  });

  describe('checkForUpdate', () => {
    const release = {
      tag_name: 'v0.2.0',
      assets: [
        {
          name: 'episode-v0.2.0.apk',
          browser_download_url: 'https://dl/episode.apk',
          content_type: 'application/vnd.android.package-archive',
          size: 10
        }
      ]
    };
    const okFetch = (async () => ({
      ok: true,
      json: async () => release
    })) as unknown as typeof fetch;

    it('returns info when the release is newer', async () => {
      const info = await checkForUpdate('0.1.0', okFetch);
      expect(info?.version).toBe('0.2.0');
    });

    it('returns null when already up to date', async () => {
      expect(await checkForUpdate('0.2.0', okFetch)).toBeNull();
    });

    it('returns null on a non-ok response', async () => {
      const badFetch = (async () => ({
        ok: false,
        json: async () => ({})
      })) as unknown as typeof fetch;
      expect(await checkForUpdate('0.1.0', badFetch)).toBeNull();
    });

    it('returns null when fetch throws (offline)', async () => {
      const throwFetch = (async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch;
      expect(await checkForUpdate('0.1.0', throwFetch)).toBeNull();
    });
  });
});
