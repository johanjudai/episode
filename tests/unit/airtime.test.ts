import { describe, it, expect } from 'vitest';
import {
  DEFAULT_BROADCAST_HOUR,
  originTimeZone,
  computeReleaseAtMs,
  localIsoDate,
  releaseTiming
} from '$lib/utils/airtime';

describe('airtime utils', () => {
  describe('originTimeZone', () => {
    it.each([
      ['US string', 'US', 'America/New_York'],
      ['JP array', ['JP'], 'Asia/Tokyo'],
      ['GB lowercase', 'gb', 'Europe/London'],
      ['FR', 'FR', 'Europe/Paris']
    ])('%s → %s', (_label, input, expected) => {
      expect(originTimeZone(input as string | string[])).toBe(expected);
    });

    it.each([
      ['null', null],
      ['undefined', undefined],
      ['empty array', []],
      ['unknown country', 'ZZ']
    ])('%s → null', (_label, input) => {
      expect(originTimeZone(input as string | string[] | null | undefined)).toBeNull();
    });
  });

  describe('computeReleaseAtMs', () => {
    it('US evening release rolls past European midnight', () => {
      /* 2026-06-15 at 20:00 EDT (UTC-4) === 2026-06-16 00:00 UTC. This is
       * exactly the case that made US shows surface a day early: the bare
       * air_date is the 15th, but the instant is already the 16th in UTC
       * (and 02:00 the 16th in Paris). */
      const ms = computeReleaseAtMs('2026-06-15', 'America/New_York', DEFAULT_BROADCAST_HOUR);
      expect(ms).toBe(Date.UTC(2026, 5, 16, 0, 0, 0));
    });

    it('Paris release stays the same UTC day', () => {
      /* 2026-06-15 20:00 CEST (UTC+2) === 2026-06-15 18:00 UTC. */
      const ms = computeReleaseAtMs('2026-06-15', 'Europe/Paris', DEFAULT_BROADCAST_HOUR);
      expect(ms).toBe(Date.UTC(2026, 5, 15, 18, 0, 0));
    });

    it('Tokyo release', () => {
      /* 2026-06-15 20:00 JST (UTC+9) === 2026-06-15 11:00 UTC. */
      const ms = computeReleaseAtMs('2026-06-15', 'Asia/Tokyo', DEFAULT_BROADCAST_HOUR);
      expect(ms).toBe(Date.UTC(2026, 5, 15, 11, 0, 0));
    });

    it.each([
      ['null air date', null, 'America/New_York'],
      ['null tz', '2026-06-15', null],
      ['malformed date', 'June 15', 'America/New_York']
    ])('%s → null', (_label, airDate, tz) => {
      expect(computeReleaseAtMs(airDate, tz)).toBeNull();
    });
  });

  describe('releaseTiming', () => {
    it('streamers unlock at midnight Pacific, i.e. the same morning in Paris', () => {
      const timing = releaseTiming('US', 'Netflix');
      expect(timing).toEqual({ timeZone: 'America/Los_Angeles', hour: 0 });
      /* 2026-06-15 00:00 PDT === 07:00 UTC === 09:00 Paris, same day. */
      const ms = computeReleaseAtMs('2026-06-15', timing?.timeZone, timing?.hour);
      expect(localIsoDate(ms!, 'Europe/Paris')).toBe('2026-06-15');
    });

    it('streamer timing ignores the origin country', () => {
      expect(releaseTiming('KR', 'Disney+')).toEqual({ timeZone: 'America/Los_Angeles', hour: 0 });
    });

    it('linear networks keep prime time in the origin zone', () => {
      expect(releaseTiming('US', 'HBO')).toEqual({
        timeZone: 'America/New_York',
        hour: DEFAULT_BROADCAST_HOUR
      });
    });

    it('unknown origin on a linear network → null', () => {
      expect(releaseTiming(null, 'HBO')).toBeNull();
    });
  });

  describe('localIsoDate', () => {
    it('buckets a release instant under the viewer-local day', () => {
      /* The US release instant from above (2026-06-16 00:00 UTC) lands on
       * the 16th in Paris but is still the 15th back in New York. */
      const ms = Date.UTC(2026, 5, 16, 0, 0, 0);
      expect(localIsoDate(ms, 'Europe/Paris')).toBe('2026-06-16');
      expect(localIsoDate(ms, 'America/New_York')).toBe('2026-06-15');
    });
  });
});
