import { describe, it, expect } from 'vitest';
import {
  normalizeSeriesName,
  parseFollowedShows,
  parseTrackingRecordsV1,
  parseTrackingRecordsV2,
  mergeWatchHistory
} from '$lib/data/tvtime-import';

describe('normalizeSeriesName', () => {
  it('lowercases and trims', () => {
    expect(normalizeSeriesName('  Severance  ')).toBe('severance');
  });
  it('folds curly apostrophes to straight', () => {
    expect(normalizeSeriesName('Marvel’s Daredevil')).toBe(
      normalizeSeriesName("Marvel's Daredevil")
    );
  });
  it('strips combining diacritics', () => {
    expect(normalizeSeriesName('Pokémon')).toBe('pokemon');
    expect(normalizeSeriesName('Pokémon')).toBe(normalizeSeriesName('Pokemon'));
  });
  it('collapses internal whitespace', () => {
    expect(normalizeSeriesName('The   Office')).toBe('the office');
  });
  it('folds smart quotes too', () => {
    expect(normalizeSeriesName('“Pilot”')).toBe('"pilot"');
  });
});

describe('parseFollowedShows', () => {
  it('parses the canonical TV Time followed_tv_show.csv', () => {
    const csv = [
      'created_at,updated_at,active,archived,tv_show_name,user_id,tv_show_id,diffusion,notification_type,folder_id,notification_offset',
      '2022-03-22 13:36:40,2022-03-22 13:36:40,1,0,Twin Peaks,54695126,70533,original,2,,1440',
      '2022-05-30 16:43:33,2022-06-13 21:31:52,1,1,Dead Like Me,54695126,72129,original,2,,1440'
    ].join('\n');
    const rows = parseFollowedShows(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      tvdbId: 70533,
      name: 'Twin Peaks',
      followedAt: new Date('2022-03-22T13:36:40Z'),
      archived: false
    });
    expect(rows[1].archived).toBe(true);
  });

  it('skips rows missing tv_show_id or name', () => {
    const csv = [
      'created_at,archived,tv_show_name,tv_show_id',
      ',0,,123',
      '2022-01-01 00:00:00,0,No ID,'
    ].join('\n');
    expect(parseFollowedShows(csv)).toHaveLength(0);
  });

  it('treats active=0 as not-followed even when archived=0', () => {
    /* Regression: TV Time has both an "active" flag (older "deleted"
     * state) and an "archived" flag (newer "stopped following"). We
     * need to honour both, otherwise old dropped series re-appear in
     * the feed post-import. */
    const csv = [
      'created_at,updated_at,active,archived,tv_show_name,user_id,tv_show_id',
      '2022-01-01 00:00:00,2022-01-01 00:00:00,0,0,Old Drop,42,999',
      '2022-01-01 00:00:00,2022-01-01 00:00:00,1,1,Archived,42,1000',
      '2022-01-01 00:00:00,2022-01-01 00:00:00,1,0,Following,42,1001'
    ].join('\n');
    const rows = parseFollowedShows(csv);
    expect(rows.find((r) => r.name === 'Old Drop')?.archived).toBe(true);
    expect(rows.find((r) => r.name === 'Archived')?.archived).toBe(true);
    expect(rows.find((r) => r.name === 'Following')?.archived).toBe(false);
  });
});

describe('parseTrackingRecordsV2', () => {
  it('keeps only watch- and rewatch-episode rows', () => {
    const csv = [
      's_id,gsi,s_no,episode_id,episode_number,ep_id,created_at,season_number,user_id,runtime,ep_no,key,series_name',
      '1,,1,10,5,10,2025-01-09 18:48:49,1,42,1440,5,watch-episode-1,Series A',
      '2,,2,11,1,11,2025-02-01 12:00:00,2,42,1440,1,rewatch-episode-2,Series A',
      '3,,,,,,,,,,,user-series-aggregate,Series A'
    ].join('\n');
    const rows = parseTrackingRecordsV2(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      seriesName: 'Series A',
      seasonNumber: 1,
      episodeNumber: 5,
      type: 'watch'
    });
    expect(rows[1].type).toBe('rewatch');
  });

  it('falls back to short s_no/ep_no when long names are blank', () => {
    const csv = [
      's_no,episode_number,ep_no,created_at,season_number,key,series_name',
      '2,,3,2025-03-01 09:00:00,,watch-episode-x,Series B'
    ].join('\n');
    const rows = parseTrackingRecordsV2(csv);
    expect(rows[0]).toMatchObject({ seasonNumber: 2, episodeNumber: 3 });
  });

  it('skips rows with non-numeric season or episode', () => {
    const csv = [
      'season_number,episode_number,created_at,key,series_name',
      'abc,1,2025-01-01,watch-episode-1,A',
      '1,xyz,2025-01-01,watch-episode-2,A'
    ].join('\n');
    expect(parseTrackingRecordsV2(csv)).toHaveLength(0);
  });
});

describe('parseTrackingRecordsV1', () => {
  it('parses the legacy tracking-prod-records format as plain watches', () => {
    const csv = [
      'cpt,created_at,updated_at,tv_show_name,episode_season_number,episode_number,user_id,episode_id',
      '1,2023-07-04 21:09:16,2023-07-04 21:09:16,Hijack,1,3,42,9266420'
    ].join('\n');
    const rows = parseTrackingRecordsV1(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      seriesName: 'Hijack',
      seasonNumber: 1,
      episodeNumber: 3,
      type: 'watch'
    });
    expect(rows[0].watchedAt?.toISOString()).toBe('2023-07-04T21:09:16.000Z');
  });
});

describe('mergeWatchHistory', () => {
  const w = (
    n: string,
    s: number,
    e: number,
    when: string,
    type: 'watch' | 'rewatch' = 'watch'
  ) => ({ seriesName: n, seasonNumber: s, episodeNumber: e, watchedAt: new Date(when), type });

  it('deduplicates same (series, S, E) and counts rewatches', () => {
    const merged = mergeWatchHistory(
      [w('A', 1, 1, '2024-01-01'), w('A', 1, 1, '2024-06-01', 'rewatch')],
      [w('A', 1, 1, '2023-12-01', 'rewatch')]
    );
    expect(merged.watches).toHaveLength(1);
    /* Keeps the earliest known date (the original "first viewing"). */
    expect(merged.watches[0].watchedAt?.toISOString()).toBe('2023-12-01T00:00:00.000Z');
    expect(merged.rewatches.get('A::S1E1')).toBe(2);
  });

  it('keeps distinct episodes apart', () => {
    const merged = mergeWatchHistory([w('A', 1, 1, '2024-01-01'), w('A', 1, 2, '2024-01-02')]);
    expect(merged.watches).toHaveLength(2);
  });

  it('does not count a lone rewatch entry as a rewatch', () => {
    /* Regression: a user whose only record for (A, S1E1) is a rewatch
     * (because the original watch predates TV Time's retained data)
     * must report rewatches=0, not 1. */
    const merged = mergeWatchHistory([w('A', 1, 1, '2024-01-01', 'rewatch')]);
    expect(merged.watches).toHaveLength(1);
    expect(merged.watches[0].type).toBe('watch');
    expect(merged.rewatches.get('A::S1E1')).toBeUndefined();
  });

  it('counts a rewatch on top of an existing watch', () => {
    const merged = mergeWatchHistory([
      w('A', 1, 1, '2024-01-01'),
      w('A', 1, 1, '2024-06-01', 'rewatch')
    ]);
    expect(merged.watches).toHaveLength(1);
    expect(merged.rewatches.get('A::S1E1')).toBe(1);
  });
});
