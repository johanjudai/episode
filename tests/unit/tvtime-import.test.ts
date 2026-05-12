import { describe, it, expect } from 'vitest';
import { parseTvTimeExport, groupBySeries, TvTimeImportError } from '$lib/data/tvtime-import';

describe('parseTvTimeExport', () => {
  it('parses a top-level array', () => {
    const raw = JSON.stringify([
      {
        show_name: 'Severance',
        season_number: 2,
        episode_number: 1,
        watched_at: '2026-05-01T20:00:00Z'
      }
    ]);
    const out = parseTvTimeExport(raw);
    expect(out).toHaveLength(1);
    expect(out[0].seriesName).toBe('Severance');
    expect(out[0].seasonNumber).toBe(2);
    expect(out[0].episodeNumber).toBe(1);
    expect(out[0].watchedAt?.toISOString()).toBe('2026-05-01T20:00:00.000Z');
  });

  it('parses a wrapped { tracking: [] } shape', () => {
    const raw = JSON.stringify({
      tracking: [
        { show_name: 'Andor', season_number: '1', episode_number: '5', watched_at: '2025-12-01' }
      ]
    });
    const out = parseTvTimeExport(raw);
    expect(out).toHaveLength(1);
    expect(out[0].seasonNumber).toBe(1);
    expect(out[0].episodeNumber).toBe(5);
  });

  it('parses a { seen_episode: [] } shape', () => {
    const raw = JSON.stringify({
      seen_episode: [{ series_name: 'Foundation', season_number: 2, episode_number: 3 }]
    });
    const out = parseTvTimeExport(raw);
    expect(out[0].seriesName).toBe('Foundation');
  });

  it('falls back across show_name / series_name', () => {
    const raw = JSON.stringify([{ series_name: 'Silo', season_number: 1, episode_number: 1 }]);
    const out = parseTvTimeExport(raw);
    expect(out[0].seriesName).toBe('Silo');
  });

  it('reads tmdb_id and show_id', () => {
    const raw = JSON.stringify([
      { show_name: 'X', tmdb_id: 999, season_number: 1, episode_number: 1 }
    ]);
    expect(parseTvTimeExport(raw)[0].tmdbId).toBe(999);
    const raw2 = JSON.stringify([
      { show_name: 'Y', show_id: '42', season_number: 1, episode_number: 1 }
    ]);
    expect(parseTvTimeExport(raw2)[0].tmdbId).toBe(42);
  });

  it('skips entries missing required fields', () => {
    const raw = JSON.stringify([
      { show_name: '', season_number: 1, episode_number: 1 },
      { show_name: 'Valid', season_number: 1, episode_number: 1 },
      { show_name: 'NoSeason', episode_number: 1 }
    ]);
    const out = parseTvTimeExport(raw);
    expect(out).toHaveLength(1);
    expect(out[0].seriesName).toBe('Valid');
  });

  it('returns null watchedAt for invalid dates', () => {
    const raw = JSON.stringify([
      { show_name: 'X', season_number: 1, episode_number: 1, watched_at: 'not-a-date' }
    ]);
    expect(parseTvTimeExport(raw)[0].watchedAt).toBeNull();
  });

  it('throws TvTimeImportError on invalid JSON', () => {
    expect(() => parseTvTimeExport('{ bad')).toThrow(TvTimeImportError);
  });

  it('throws TvTimeImportError on unrecognized shape', () => {
    expect(() => parseTvTimeExport(JSON.stringify({ foo: 'bar' }))).toThrow(TvTimeImportError);
  });

  it('throws on non-object/non-array root', () => {
    expect(() => parseTvTimeExport('42')).toThrow(TvTimeImportError);
    expect(() => parseTvTimeExport('"string"')).toThrow(TvTimeImportError);
  });

  it('ignores malformed records but keeps valid ones', () => {
    const raw = JSON.stringify([
      'not an object',
      null,
      { show_name: 'OK', season_number: 1, episode_number: 1 }
    ]);
    const out = parseTvTimeExport(raw);
    expect(out).toHaveLength(1);
    expect(out[0].seriesName).toBe('OK');
  });
});

describe('groupBySeries', () => {
  it('groups entries by series name', () => {
    const grouped = groupBySeries([
      {
        seriesName: 'A',
        tmdbId: null,
        seasonNumber: 1,
        episodeNumber: 1,
        watchedAt: new Date('2025-01-01')
      },
      {
        seriesName: 'A',
        tmdbId: null,
        seasonNumber: 1,
        episodeNumber: 2,
        watchedAt: new Date('2025-01-02')
      },
      {
        seriesName: 'B',
        tmdbId: null,
        seasonNumber: 1,
        episodeNumber: 1,
        watchedAt: new Date('2025-01-03')
      }
    ]);
    expect(grouped.get('A')).toHaveLength(2);
    expect(grouped.get('B')).toHaveLength(1);
  });

  it('keeps the most recent watchedAt for duplicate episodes', () => {
    const grouped = groupBySeries([
      {
        seriesName: 'A',
        tmdbId: null,
        seasonNumber: 1,
        episodeNumber: 1,
        watchedAt: new Date('2025-01-01')
      },
      {
        seriesName: 'A',
        tmdbId: null,
        seasonNumber: 1,
        episodeNumber: 1,
        watchedAt: new Date('2025-06-01')
      }
    ]);
    const list = grouped.get('A')!;
    expect(list).toHaveLength(1);
    expect(list[0].watchedAt?.toISOString()).toBe('2025-06-01T00:00:00.000Z');
  });
});
