import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/db', async () => {
  const Database = (await import('better-sqlite3')).default;
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
  const schema = await import('../../src/lib/server/db/schema');

  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: './src/lib/server/db/migrations' });

  return { db, sqlite, ...schema };
});

import {
  followSeries,
  getEpisodesToWatch,
  getFollowedSeriesWithProgress,
  getRecentWatched,
  getSeries,
  getSetting,
  getStats,
  getUpcomingEpisodes,
  markEpisodeWatched,
  markEpisodesUpTo,
  markSeasonWatched,
  markSeasonsUpTo,
  markSeriesWatched,
  setSetting,
  unfollowSeries,
  unmarkEpisodeWatched,
  unmarkSeasonWatched
} from '$lib/server/db/queries';
import { sqlite, db, episodes, seasons } from '$lib/server/db';

function seedSeason(
  seriesTmdbId: number,
  seasonNumber: number,
  episodeCount: number,
  airDates: (string | null)[] = []
) {
  /* Use raw SQLite — bypasses drizzle types for direct setup convenience. */
  const seasonStmt = sqlite.prepare(
    `INSERT INTO seasons (series_tmdb_id, season_number, episode_count) VALUES (?, ?, ?)`
  );
  const info = seasonStmt.run(seriesTmdbId, seasonNumber, episodeCount);
  const seasonId = Number(info.lastInsertRowid);

  const epStmt = sqlite.prepare(`
    INSERT INTO episodes (season_id, series_tmdb_id, season_number, episode_number, name, air_date, runtime_minutes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (let i = 1; i <= episodeCount; i++) {
    epStmt.run(
      seasonId,
      seriesTmdbId,
      seasonNumber,
      i,
      `S${seasonNumber}E${i}`,
      airDates[i - 1] ?? null,
      45
    );
  }
}

beforeEach(() => {
  sqlite.exec(`
    DELETE FROM watched;
    DELETE FROM episodes;
    DELETE FROM seasons;
    DELETE FROM series;
    DELETE FROM settings;
  `);
});

describe('settings kv', () => {
  it('returns null for unset key', async () => {
    expect(await getSetting('nope')).toBeNull();
  });

  it('round-trips a value', async () => {
    await setSetting('profile.name', 'Pierre');
    expect(await getSetting('profile.name')).toBe('Pierre');
  });

  it('upserts on repeat set', async () => {
    await setSetting('k', 'a');
    await setSetting('k', 'b');
    expect(await getSetting('k')).toBe('b');
  });

  it('stores null explicitly', async () => {
    await setSetting('k', 'a');
    await setSetting('k', null);
    expect(await getSetting('k')).toBeNull();
  });
});

describe('followSeries / unfollowSeries / getSeries', () => {
  it('inserts a series row', async () => {
    await followSeries({ tmdbId: 1, name: 'A' });
    const s = await getSeries(1);
    expect(s?.name).toBe('A');
    expect(s?.removedAt).toBeNull();
    expect(s?.addedAt).toBeInstanceOf(Date);
  });

  it('re-follow clears removedAt', async () => {
    await followSeries({ tmdbId: 1, name: 'A' });
    await unfollowSeries(1);
    const removed = await getSeries(1);
    expect(removed?.removedAt).toBeInstanceOf(Date);

    await followSeries({ tmdbId: 1, name: 'A' });
    const back = await getSeries(1);
    expect(back?.removedAt).toBeNull();
  });

  it('unfollowSeries sets removedAt for an existing row', async () => {
    await followSeries({ tmdbId: 1, name: 'A' });
    await unfollowSeries(1);
    expect((await getSeries(1))?.removedAt).toBeInstanceOf(Date);
  });
});

describe('getFollowedSeriesWithProgress (regression for /series 500)', () => {
  it('returns empty array when nothing is followed', async () => {
    expect(await getFollowedSeriesWithProgress()).toEqual([]);
  });

  it('returns 0/0 for a fresh series with no episodes synced yet', async () => {
    await followSeries({ tmdbId: 1, name: 'A' });
    const rows = await getFollowedSeriesWithProgress();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ totalEpisodes: 0, watchedCount: 0, name: 'A' });
  });

  it('computes totalEpisodes from the episodes table', async () => {
    await followSeries({ tmdbId: 1, name: 'A' });
    seedSeason(1, 1, 3);
    const rows = await getFollowedSeriesWithProgress();
    expect(rows[0].totalEpisodes).toBe(3);
    expect(rows[0].watchedCount).toBe(0);
  });

  it('counts watched episodes via the join (the case that broke before)', async () => {
    await followSeries({ tmdbId: 1, name: 'A' });
    seedSeason(1, 1, 3);
    const epIds = sqlite
      .prepare(`SELECT id FROM episodes WHERE series_tmdb_id = 1 ORDER BY episode_number`)
      .all() as Array<{ id: number }>;
    await markEpisodeWatched(epIds[0].id);
    await markEpisodeWatched(epIds[1].id);

    const rows = await getFollowedSeriesWithProgress();
    expect(rows[0].watchedCount).toBe(2);
    expect(rows[0].totalEpisodes).toBe(3);
  });

  it('excludes unfollowed series', async () => {
    await followSeries({ tmdbId: 1, name: 'Kept' });
    await followSeries({ tmdbId: 2, name: 'Gone' });
    await unfollowSeries(2);
    const rows = await getFollowedSeriesWithProgress();
    expect(rows.map((r) => r.name)).toEqual(['Kept']);
  });

  it('sorts by addedAt desc (most recently added first)', async () => {
    await followSeries({ tmdbId: 1, name: 'First' });
    /* Bump addedAt by sleeping a millisecond — addedAt resolution is ms */
    await new Promise((r) => setTimeout(r, 2));
    await followSeries({ tmdbId: 2, name: 'Second' });
    const rows = await getFollowedSeriesWithProgress();
    expect(rows.map((r) => r.name)).toEqual(['Second', 'First']);
  });
});

describe('getEpisodesToWatch', () => {
  const today = '2026-05-11';
  const now = new Date(`${today}T12:00:00Z`);

  it('returns only released, unwatched episodes for followed series', async () => {
    await followSeries({ tmdbId: 1, name: 'A' });
    seedSeason(1, 1, 3, ['2026-05-09', '2026-05-10', '2026-05-12']); // last is future

    const rows = await getEpisodesToWatch(now);
    expect(rows.map((r) => r.episodeNumber)).toEqual([1, 2]);
  });

  it('hides watched episodes', async () => {
    await followSeries({ tmdbId: 1, name: 'A' });
    seedSeason(1, 1, 3, ['2026-05-09', '2026-05-10', '2026-05-11']);
    const epIds = sqlite
      .prepare(`SELECT id FROM episodes WHERE series_tmdb_id = 1 ORDER BY episode_number`)
      .all() as Array<{ id: number }>;
    await markEpisodeWatched(epIds[1].id);

    const rows = await getEpisodesToWatch(now);
    expect(rows.map((r) => r.episodeNumber)).toEqual([1, 3]);
  });

  it('excludes unfollowed series', async () => {
    await followSeries({ tmdbId: 1, name: 'Kept' });
    await followSeries({ tmdbId: 2, name: 'Gone' });
    seedSeason(1, 1, 1, ['2026-05-09']);
    seedSeason(2, 1, 1, ['2026-05-09']);
    await unfollowSeries(2);

    const rows = await getEpisodesToWatch(now);
    expect(rows.map((r) => r.seriesName)).toEqual(['Kept']);
  });

  it('orders by series, season, episode (so pickNextPerSeries picks the earliest)', async () => {
    await followSeries({ tmdbId: 7, name: 'Z' });
    await followSeries({ tmdbId: 8, name: 'A' });
    seedSeason(7, 2, 2, ['2026-05-01', '2026-05-02']);
    seedSeason(7, 1, 2, ['2026-04-01', '2026-04-02']);
    seedSeason(8, 1, 1, ['2026-05-09']);

    const rows = await getEpisodesToWatch(now);
    /* Series 7 group first (lower tmdb_id), with S1E1 before S1E2 before S2E1 */
    expect(rows.map((r) => `${r.seriesTmdbId}:S${r.seasonNumber}E${r.episodeNumber}`)).toEqual([
      '7:S1E1',
      '7:S1E2',
      '7:S2E1',
      '7:S2E2',
      '8:S1E1'
    ]);
  });
});

describe('getUpcomingEpisodes', () => {
  const now = new Date('2026-05-11T12:00:00Z');

  it('returns episodes airing today through today+N days', async () => {
    await followSeries({ tmdbId: 1, name: 'A' });
    seedSeason(1, 1, 4, [
      '2026-05-10', // past
      '2026-05-11', // today
      '2026-05-15', // within window
      '2026-05-25' // beyond
    ]);

    const rows = await getUpcomingEpisodes(7, now);
    expect(rows.map((r) => r.airDate)).toEqual(['2026-05-11', '2026-05-15']);
  });

  it('excludes unfollowed series', async () => {
    await followSeries({ tmdbId: 1, name: 'Gone' });
    seedSeason(1, 1, 1, ['2026-05-12']);
    await unfollowSeries(1);
    expect(await getUpcomingEpisodes(7, now)).toEqual([]);
  });
});

describe('mark / unmark episode', () => {
  it('mark is idempotent (only one watched row)', async () => {
    await followSeries({ tmdbId: 1, name: 'A' });
    seedSeason(1, 1, 1);
    const id = (sqlite.prepare(`SELECT id FROM episodes`).get() as { id: number }).id;
    await markEpisodeWatched(id);
    await markEpisodeWatched(id);
    const n = sqlite.prepare(`SELECT COUNT(*) as n FROM watched`).get() as { n: number };
    expect(n.n).toBe(1);
  });

  it('unmark removes the watched row', async () => {
    await followSeries({ tmdbId: 1, name: 'A' });
    seedSeason(1, 1, 1);
    const id = (sqlite.prepare(`SELECT id FROM episodes`).get() as { id: number }).id;
    await markEpisodeWatched(id);
    await unmarkEpisodeWatched(id);
    const n = sqlite.prepare(`SELECT COUNT(*) as n FROM watched`).get() as { n: number };
    expect(n.n).toBe(0);
  });
});

describe('mark / unmark season', () => {
  it('marks every episode in the season', async () => {
    await followSeries({ tmdbId: 1, name: 'A' });
    seedSeason(1, 1, 5);
    seedSeason(1, 2, 3);
    await markSeasonWatched(1, 1);
    const n = sqlite.prepare(`SELECT COUNT(*) as n FROM watched`).get() as { n: number };
    expect(n.n).toBe(5);
  });

  it('unmark removes every watched row in that season only', async () => {
    await followSeries({ tmdbId: 1, name: 'A' });
    seedSeason(1, 1, 2);
    seedSeason(1, 2, 2);
    await markSeasonWatched(1, 1);
    await markSeasonWatched(1, 2);
    await unmarkSeasonWatched(1, 1);

    const remaining = sqlite
      .prepare(
        `SELECT e.season_number FROM watched w JOIN episodes e ON e.id = w.episode_id`
      )
      .all() as Array<{ season_number: number }>;
    expect(remaining.map((r) => r.season_number).sort()).toEqual([2, 2]);
  });
});

describe('markEpisodesUpTo (skip-ahead confirmation)', () => {
  it('marks every episode up to and including (season, episode)', async () => {
    await followSeries({ tmdbId: 1, name: 'A' });
    seedSeason(1, 1, 3);
    seedSeason(1, 2, 3);
    seedSeason(1, 3, 2);

    /* Target = S2E2 → expect S1E1..S1E3 + S2E1 + S2E2 = 5 marked */
    await markEpisodesUpTo(1, 2, 2);
    const marked = sqlite
      .prepare(
        `SELECT e.season_number as s, e.episode_number as e FROM watched w JOIN episodes e ON e.id = w.episode_id ORDER BY s, e`
      )
      .all() as Array<{ s: number; e: number }>;
    expect(marked).toEqual([
      { s: 1, e: 1 },
      { s: 1, e: 2 },
      { s: 1, e: 3 },
      { s: 2, e: 1 },
      { s: 2, e: 2 }
    ]);
  });

  it('does not touch episodes after the threshold', async () => {
    await followSeries({ tmdbId: 1, name: 'A' });
    seedSeason(1, 1, 2);
    seedSeason(1, 2, 2);
    await markEpisodesUpTo(1, 1, 2);
    const n = sqlite.prepare(`SELECT COUNT(*) as n FROM watched`).get() as { n: number };
    expect(n.n).toBe(2);
  });
});

describe('markSeasonsUpTo', () => {
  it('marks every episode of every season ≤ target', async () => {
    await followSeries({ tmdbId: 1, name: 'A' });
    seedSeason(1, 1, 3);
    seedSeason(1, 2, 2);
    seedSeason(1, 3, 4);
    await markSeasonsUpTo(1, 2);
    const n = sqlite.prepare(`SELECT COUNT(*) as n FROM watched`).get() as { n: number };
    expect(n.n).toBe(5); // S1 (3) + S2 (2)
  });
});

describe('markSeriesWatched', () => {
  it('marks every episode of the series', async () => {
    await followSeries({ tmdbId: 1, name: 'A' });
    seedSeason(1, 1, 3);
    seedSeason(1, 2, 2);
    await markSeriesWatched(1);
    const n = sqlite.prepare(`SELECT COUNT(*) as n FROM watched`).get() as { n: number };
    expect(n.n).toBe(5);
  });
});

describe('getRecentWatched', () => {
  it('returns watched rows in reverse chronological order', async () => {
    await followSeries({ tmdbId: 1, name: 'A' });
    seedSeason(1, 1, 2);
    const eps = sqlite
      .prepare(`SELECT id FROM episodes ORDER BY episode_number`)
      .all() as Array<{ id: number }>;
    await markEpisodeWatched(eps[0].id, new Date('2026-05-09T20:00:00Z'));
    await markEpisodeWatched(eps[1].id, new Date('2026-05-10T20:00:00Z'));

    const rows = await getRecentWatched(10);
    expect(rows.map((r) => r.episodeNumber)).toEqual([2, 1]);
    expect(rows[0].seriesName).toBe('A');
  });

  it('respects the limit', async () => {
    await followSeries({ tmdbId: 1, name: 'A' });
    seedSeason(1, 1, 5);
    const eps = sqlite
      .prepare(`SELECT id FROM episodes ORDER BY episode_number`)
      .all() as Array<{ id: number }>;
    for (const e of eps) await markEpisodeWatched(e.id);
    expect((await getRecentWatched(3))).toHaveLength(3);
  });
});

describe('getStats', () => {
  it('totals runtime and episode count, plus active series', async () => {
    await followSeries({ tmdbId: 1, name: 'A' });
    await followSeries({ tmdbId: 2, name: 'B' });
    seedSeason(1, 1, 2);
    seedSeason(2, 1, 1);

    const epsA = sqlite
      .prepare(`SELECT id FROM episodes WHERE series_tmdb_id = 1`)
      .all() as Array<{ id: number }>;
    for (const e of epsA) await markEpisodeWatched(e.id);

    const stats = await getStats();
    expect(stats.episodesWatched).toBe(2);
    expect(stats.totalMinutes).toBe(90); // 2 × 45 min runtime
    expect(stats.seriesCount).toBe(2);
  });

  it('excludes unfollowed series from seriesCount but keeps watched in totals', async () => {
    await followSeries({ tmdbId: 1, name: 'A' });
    seedSeason(1, 1, 1);
    const e = (sqlite.prepare(`SELECT id FROM episodes`).get() as { id: number }).id;
    await markEpisodeWatched(e);
    await unfollowSeries(1);

    const stats = await getStats();
    expect(stats.seriesCount).toBe(0);
    expect(stats.episodesWatched).toBe(1);
  });
});
