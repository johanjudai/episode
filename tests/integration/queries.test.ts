/**
 * Query / mutation integration suite. The same suite runs against BOTH the
 * better-sqlite3 (Node) and sql.js (WASM) drivers, so any divergence between
 * the two surfaces (e.g. autoincrement semantics, FK enforcement, NULL handling
 * in indexes) is caught immediately. Driver glue lives in `_drivers.ts`.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  getEpisodesToWatch,
  getFollowedSeriesWithProgress,
  getRecentWatched,
  getSeries,
  getSetting,
  getStats,
  getUpcomingEpisodes
} from '../../src/lib/data/queries';
import {
  followSeries,
  markEpisodeWatched,
  markEpisodesUpTo,
  markSeasonWatched,
  markSeasonsUpTo,
  markSeriesWatched,
  setSetting,
  unfollowSeries,
  unmarkEpisodeWatched,
  unmarkSeasonWatched
} from '../../src/lib/data/mutations';
import { DUAL_DRIVERS, type DriverContext } from './_drivers';

for (const driver of DUAL_DRIVERS) {
  describe(`queries / mutations (${driver.name})`, () => {
    let ctx: DriverContext;

    function insertSeason(
      seriesTmdbId: number,
      seasonNumber: number,
      episodeCount: number
    ): number {
      ctx.raw.run(
        'INSERT INTO seasons (series_tmdb_id, season_number, episode_count) VALUES (?, ?, ?)',
        [seriesTmdbId, seasonNumber, episodeCount]
      );
      return ctx.raw.lastInsertId();
    }

    function insertEpisode(
      seasonId: number,
      seriesTmdbId: number,
      seasonNumber: number,
      episodeNumber: number,
      name: string,
      airDate: string | null,
      runtime: number
    ): void {
      ctx.raw.run(
        `INSERT INTO episodes
          (season_id, series_tmdb_id, season_number, episode_number, name, air_date, runtime_minutes)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [seasonId, seriesTmdbId, seasonNumber, episodeNumber, name, airDate, runtime]
      );
    }

    function seedSeason(
      seriesTmdbId: number,
      seasonNumber: number,
      episodeCount: number,
      airDates: (string | null)[] = []
    ) {
      const seasonId = insertSeason(seriesTmdbId, seasonNumber, episodeCount);
      for (let i = 1; i <= episodeCount; i++) {
        insertEpisode(
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

    beforeEach(async () => {
      ctx = await driver.setup();
    });

    afterAll(async () => {
      if (ctx) await ctx.cleanup();
    });

    describe('settings kv', () => {
      it('returns null for unset key', async () => {
        expect(await getSetting(ctx.db, 'nope')).toBeNull();
      });

      it('round-trips a value', async () => {
        await setSetting(ctx.db, 'profile.name', 'Pierre');
        expect(await getSetting(ctx.db, 'profile.name')).toBe('Pierre');
      });

      it('upserts on repeat set', async () => {
        await setSetting(ctx.db, 'k', 'a');
        await setSetting(ctx.db, 'k', 'b');
        expect(await getSetting(ctx.db, 'k')).toBe('b');
      });

      it('stores null explicitly', async () => {
        await setSetting(ctx.db, 'k', 'a');
        await setSetting(ctx.db, 'k', null);
        expect(await getSetting(ctx.db, 'k')).toBeNull();
      });
    });

    describe('followSeries / unfollowSeries / getSeries', () => {
      it('inserts a series row', async () => {
        await followSeries(ctx.db, { tmdbId: 1, name: 'A' });
        const s = await getSeries(ctx.db, 1);
        expect(s?.name).toBe('A');
        expect(s?.removedAt).toBeNull();
        expect(s?.addedAt).toBeInstanceOf(Date);
      });

      it('re-follow clears removedAt', async () => {
        await followSeries(ctx.db, { tmdbId: 1, name: 'A' });
        await unfollowSeries(ctx.db, 1);
        expect((await getSeries(ctx.db, 1))?.removedAt).toBeInstanceOf(Date);

        await followSeries(ctx.db, { tmdbId: 1, name: 'A' });
        expect((await getSeries(ctx.db, 1))?.removedAt).toBeNull();
      });

      it('unfollowSeries sets removedAt', async () => {
        await followSeries(ctx.db, { tmdbId: 1, name: 'A' });
        await unfollowSeries(ctx.db, 1);
        expect((await getSeries(ctx.db, 1))?.removedAt).toBeInstanceOf(Date);
      });
    });

    describe('getFollowedSeriesWithProgress', () => {
      it('returns empty array when nothing is followed', async () => {
        expect(await getFollowedSeriesWithProgress(ctx.db)).toEqual([]);
      });

      it('returns 0/0 for a fresh series with no episodes synced yet', async () => {
        await followSeries(ctx.db, { tmdbId: 1, name: 'A' });
        const rows = await getFollowedSeriesWithProgress(ctx.db);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ totalEpisodes: 0, watchedCount: 0, name: 'A' });
      });

      it('computes totalEpisodes from the episodes table', async () => {
        await followSeries(ctx.db, { tmdbId: 1, name: 'A' });
        seedSeason(1, 1, 3);
        const rows = await getFollowedSeriesWithProgress(ctx.db);
        expect(rows[0].totalEpisodes).toBe(3);
        expect(rows[0].watchedCount).toBe(0);
      });

      it('counts watched episodes via the join', async () => {
        await followSeries(ctx.db, { tmdbId: 1, name: 'A' });
        seedSeason(1, 1, 3);
        const epIds = ctx.raw.prepareAll<{ id: number }>(
          'SELECT id FROM episodes WHERE series_tmdb_id = 1 ORDER BY episode_number'
        );
        await markEpisodeWatched(ctx.db, epIds[0].id);
        await markEpisodeWatched(ctx.db, epIds[1].id);
        const rows = await getFollowedSeriesWithProgress(ctx.db);
        expect(rows[0].watchedCount).toBe(2);
        expect(rows[0].totalEpisodes).toBe(3);
      });

      it('excludes unfollowed series', async () => {
        await followSeries(ctx.db, { tmdbId: 1, name: 'Kept' });
        await followSeries(ctx.db, { tmdbId: 2, name: 'Gone' });
        await unfollowSeries(ctx.db, 2);
        const rows = await getFollowedSeriesWithProgress(ctx.db);
        expect(rows.map((r) => r.name)).toEqual(['Kept']);
      });

      it('sorts by addedAt desc', async () => {
        await followSeries(ctx.db, { tmdbId: 1, name: 'First' });
        await new Promise((r) => setTimeout(r, 2));
        await followSeries(ctx.db, { tmdbId: 2, name: 'Second' });
        const rows = await getFollowedSeriesWithProgress(ctx.db);
        expect(rows.map((r) => r.name)).toEqual(['Second', 'First']);
      });
    });

    describe('getEpisodesToWatch', () => {
      const today = '2026-05-11';
      const now = new Date(`${today}T12:00:00Z`);

      /* Contract: returns ONE row per followed series — the earliest
       * (season, episode) that has aired and isn't watched yet. The
       * JS-side dedupe (pickNextPerSeries) was removed in favor of a
       * window function in SQL; tests reflect that. */

      it('returns the earliest released, unwatched episode for each followed series', async () => {
        await followSeries(ctx.db, { tmdbId: 1, name: 'A' });
        seedSeason(1, 1, 3, ['2026-05-09', '2026-05-10', '2026-05-12']);
        const rows = await getEpisodesToWatch(ctx.db, now);
        expect(rows.map((r) => r.episodeNumber)).toEqual([1]);
      });

      it('skips watched episodes when picking the next one', async () => {
        await followSeries(ctx.db, { tmdbId: 1, name: 'A' });
        seedSeason(1, 1, 3, ['2026-05-09', '2026-05-10', '2026-05-11']);
        const epIds = ctx.raw.prepareAll<{ id: number }>(
          'SELECT id FROM episodes WHERE series_tmdb_id = 1 ORDER BY episode_number'
        );
        /* Watch episode 1 — the next-to-watch should be episode 2 (still
         * aired, still unwatched). Episode 3 is also unwatched but we
         * only return the earliest per series. */
        await markEpisodeWatched(ctx.db, epIds[0].id);
        const rows = await getEpisodesToWatch(ctx.db, now);
        expect(rows.map((r) => r.episodeNumber)).toEqual([2]);
      });

      it('excludes unfollowed series', async () => {
        await followSeries(ctx.db, { tmdbId: 1, name: 'Kept' });
        await followSeries(ctx.db, { tmdbId: 2, name: 'Gone' });
        seedSeason(1, 1, 1, ['2026-05-09']);
        seedSeason(2, 1, 1, ['2026-05-09']);
        await unfollowSeries(ctx.db, 2);
        const rows = await getEpisodesToWatch(ctx.db, now);
        expect(rows.map((r) => r.seriesName)).toEqual(['Kept']);
      });

      it('picks the earliest (season, episode) across multiple seasons of one series', async () => {
        await followSeries(ctx.db, { tmdbId: 7, name: 'Z' });
        await followSeries(ctx.db, { tmdbId: 8, name: 'A' });
        /* Seed S2 first to verify ORDER BY isn't accidentally relying
         * on insertion order. */
        seedSeason(7, 2, 2, ['2026-05-01', '2026-05-02']);
        seedSeason(7, 1, 2, ['2026-04-01', '2026-04-02']);
        seedSeason(8, 1, 1, ['2026-05-09']);
        const rows = await getEpisodesToWatch(ctx.db, now);
        expect(rows.map((r) => `${r.seriesTmdbId}:S${r.seasonNumber}E${r.episodeNumber}`)).toEqual([
          '7:S1E1',
          '8:S1E1'
        ]);
      });
    });

    describe('getUpcomingEpisodes', () => {
      const now = new Date('2026-05-11T12:00:00Z');

      it('returns episodes strictly after today through today+N days', async () => {
        await followSeries(ctx.db, { tmdbId: 1, name: 'A' });
        seedSeason(1, 1, 4, ['2026-05-10', '2026-05-11', '2026-05-15', '2026-05-25']);
        const rows = await getUpcomingEpisodes(ctx.db, 7, now);
        /* 2026-05-10 = past → excluded.
         * 2026-05-11 = today → excluded (belongs to "À voir maintenant").
         * 2026-05-15 = within 7-day window → kept.
         * 2026-05-25 = past 7-day window → excluded. */
        expect(rows.map((r) => r.airDate)).toEqual(['2026-05-15']);
      });

      it('excludes unfollowed series', async () => {
        await followSeries(ctx.db, { tmdbId: 1, name: 'Gone' });
        seedSeason(1, 1, 1, ['2026-05-12']);
        await unfollowSeries(ctx.db, 1);
        expect(await getUpcomingEpisodes(ctx.db, 7, now)).toEqual([]);
      });
    });

    describe('mark / unmark episode', () => {
      it('mark is idempotent', async () => {
        await followSeries(ctx.db, { tmdbId: 1, name: 'A' });
        seedSeason(1, 1, 1);
        const id = ctx.raw.prepareGet<{ id: number }>('SELECT id FROM episodes')!.id;
        await markEpisodeWatched(ctx.db, id);
        await markEpisodeWatched(ctx.db, id);
        const n = ctx.raw.prepareGet<{ n: number }>('SELECT COUNT(*) as n FROM watched')!.n;
        expect(Number(n)).toBe(1);
      });

      it('unmark removes the watched row', async () => {
        await followSeries(ctx.db, { tmdbId: 1, name: 'A' });
        seedSeason(1, 1, 1);
        const id = ctx.raw.prepareGet<{ id: number }>('SELECT id FROM episodes')!.id;
        await markEpisodeWatched(ctx.db, id);
        await unmarkEpisodeWatched(ctx.db, id);
        const n = ctx.raw.prepareGet<{ n: number }>('SELECT COUNT(*) as n FROM watched')!.n;
        expect(Number(n)).toBe(0);
      });
    });

    describe('mark / unmark season', () => {
      it('marks every episode in the season', async () => {
        await followSeries(ctx.db, { tmdbId: 1, name: 'A' });
        seedSeason(1, 1, 5);
        seedSeason(1, 2, 3);
        await markSeasonWatched(ctx.db, 1, 1);
        const n = ctx.raw.prepareGet<{ n: number }>('SELECT COUNT(*) as n FROM watched')!.n;
        expect(Number(n)).toBe(5);
      });

      it('unmark removes every watched row in that season only', async () => {
        await followSeries(ctx.db, { tmdbId: 1, name: 'A' });
        seedSeason(1, 1, 2);
        seedSeason(1, 2, 2);
        await markSeasonWatched(ctx.db, 1, 1);
        await markSeasonWatched(ctx.db, 1, 2);
        await unmarkSeasonWatched(ctx.db, 1, 1);
        const remaining = ctx.raw.prepareAll<{ season_number: number }>(
          'SELECT e.season_number as season_number FROM watched w JOIN episodes e ON e.id = w.episode_id'
        );
        expect(remaining.map((r) => Number(r.season_number)).sort()).toEqual([2, 2]);
      });
    });

    describe('markEpisodesUpTo', () => {
      it('marks every episode up to and including (season, episode)', async () => {
        await followSeries(ctx.db, { tmdbId: 1, name: 'A' });
        seedSeason(1, 1, 3);
        seedSeason(1, 2, 3);
        seedSeason(1, 3, 2);

        await markEpisodesUpTo(ctx.db, 1, 2, 2);
        const marked = ctx.raw.prepareAll<{ s: number; e: number }>(
          'SELECT e.season_number as s, e.episode_number as e FROM watched w JOIN episodes e ON e.id = w.episode_id ORDER BY s, e'
        );
        expect(marked.map((r) => ({ s: Number(r.s), e: Number(r.e) }))).toEqual([
          { s: 1, e: 1 },
          { s: 1, e: 2 },
          { s: 1, e: 3 },
          { s: 2, e: 1 },
          { s: 2, e: 2 }
        ]);
      });

      it('does not touch episodes after the threshold', async () => {
        await followSeries(ctx.db, { tmdbId: 1, name: 'A' });
        seedSeason(1, 1, 2);
        seedSeason(1, 2, 2);
        await markEpisodesUpTo(ctx.db, 1, 1, 2);
        const n = ctx.raw.prepareGet<{ n: number }>('SELECT COUNT(*) as n FROM watched')!.n;
        expect(Number(n)).toBe(2);
      });
    });

    describe('markSeasonsUpTo', () => {
      it('marks every episode of every season ≤ target', async () => {
        await followSeries(ctx.db, { tmdbId: 1, name: 'A' });
        seedSeason(1, 1, 3);
        seedSeason(1, 2, 2);
        seedSeason(1, 3, 4);
        await markSeasonsUpTo(ctx.db, 1, 2);
        const n = ctx.raw.prepareGet<{ n: number }>('SELECT COUNT(*) as n FROM watched')!.n;
        expect(Number(n)).toBe(5);
      });
    });

    describe('markSeriesWatched', () => {
      it('marks every episode of the series', async () => {
        await followSeries(ctx.db, { tmdbId: 1, name: 'A' });
        seedSeason(1, 1, 3);
        seedSeason(1, 2, 2);
        await markSeriesWatched(ctx.db, 1);
        const n = ctx.raw.prepareGet<{ n: number }>('SELECT COUNT(*) as n FROM watched')!.n;
        expect(Number(n)).toBe(5);
      });
    });

    describe('getRecentWatched', () => {
      it('returns watched rows in reverse chronological order', async () => {
        await followSeries(ctx.db, { tmdbId: 1, name: 'A' });
        seedSeason(1, 1, 2);
        const eps = ctx.raw.prepareAll<{ id: number }>(
          'SELECT id FROM episodes ORDER BY episode_number'
        );
        await markEpisodeWatched(ctx.db, eps[0].id, new Date('2026-05-09T20:00:00Z'));
        await markEpisodeWatched(ctx.db, eps[1].id, new Date('2026-05-10T20:00:00Z'));
        const rows = await getRecentWatched(ctx.db, 10);
        expect(rows.map((r) => r.episodeNumber)).toEqual([2, 1]);
        expect(rows[0].seriesName).toBe('A');
      });

      it('respects the limit', async () => {
        await followSeries(ctx.db, { tmdbId: 1, name: 'A' });
        seedSeason(1, 1, 5);
        const eps = ctx.raw.prepareAll<{ id: number }>(
          'SELECT id FROM episodes ORDER BY episode_number'
        );
        for (const e of eps) await markEpisodeWatched(ctx.db, e.id);
        expect(await getRecentWatched(ctx.db, 3)).toHaveLength(3);
      });

      it('paginates with offset (older items in subsequent pages)', async () => {
        await followSeries(ctx.db, { tmdbId: 1, name: 'A' });
        seedSeason(1, 1, 7);
        const eps = ctx.raw.prepareAll<{ id: number }>(
          'SELECT id FROM episodes ORDER BY episode_number'
        );
        /* Mark each with a strictly increasing watchedAt so the DESC
         * order matches episodeNumber DESC. */
        for (let i = 0; i < eps.length; i++) {
          await markEpisodeWatched(
            ctx.db,
            eps[i].id,
            new Date(`2026-05-${String(10 + i).padStart(2, '0')}T20:00:00Z`)
          );
        }
        const page1 = await getRecentWatched(ctx.db, 3, 0);
        const page2 = await getRecentWatched(ctx.db, 3, 3);
        const page3 = await getRecentWatched(ctx.db, 3, 6);
        expect(page1.map((r) => r.episodeNumber)).toEqual([7, 6, 5]);
        expect(page2.map((r) => r.episodeNumber)).toEqual([4, 3, 2]);
        expect(page3.map((r) => r.episodeNumber)).toEqual([1]);
      });
    });

    describe('getStats', () => {
      it('totals runtime, episode count, and active series', async () => {
        await followSeries(ctx.db, { tmdbId: 1, name: 'A' });
        await followSeries(ctx.db, { tmdbId: 2, name: 'B' });
        seedSeason(1, 1, 2);
        seedSeason(2, 1, 1);

        const epsA = ctx.raw.prepareAll<{ id: number }>(
          'SELECT id FROM episodes WHERE series_tmdb_id = 1'
        );
        for (const e of epsA) await markEpisodeWatched(ctx.db, e.id);

        const stats = await getStats(ctx.db);
        expect(stats.episodesWatched).toBe(2);
        expect(stats.totalMinutes).toBe(90);
        expect(stats.seriesCount).toBe(2);
        expect(stats.animeCount).toBe(0);
      });

      it('excludes unfollowed series from seriesCount but keeps watched in totals', async () => {
        await followSeries(ctx.db, { tmdbId: 1, name: 'A' });
        seedSeason(1, 1, 1);
        const id = ctx.raw.prepareGet<{ id: number }>('SELECT id FROM episodes')!.id;
        await markEpisodeWatched(ctx.db, id);
        await unfollowSeries(ctx.db, 1);

        const stats = await getStats(ctx.db);
        expect(stats.seriesCount).toBe(0);
        expect(stats.episodesWatched).toBe(1);
      });

      it('splits anime out of seriesCount via the is_anime flag', async () => {
        await followSeries(ctx.db, { tmdbId: 1, name: 'Regular show' });
        await followSeries(ctx.db, { tmdbId: 2, name: 'An anime', isAnime: true });
        await followSeries(ctx.db, { tmdbId: 3, name: 'Legacy (NULL flag)' });

        const stats = await getStats(ctx.db);
        /* tmdbId 2 is anime; 1 and 3 (NULL flag) count as regular series. */
        expect(stats.seriesCount).toBe(2);
        expect(stats.animeCount).toBe(1);
      });
    });
  });
}
