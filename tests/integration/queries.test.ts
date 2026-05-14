/**
 * Query / mutation integration suite. The same suite runs against BOTH the
 * better-sqlite3 (Node) and sql.js (WASM) drivers, so any divergence between
 * the two surfaces (e.g. autoincrement semantics, FK enforcement, NULL handling
 * in indexes) is caught immediately.
 *
 * The two drivers share the schema (`$lib/data/schema`), so we apply the same
 * SQL DDL to a fresh in-memory database before each test, then run the high-
 * level queries from `$lib/data/queries` + `$lib/data/mutations` against it.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle as drizzleNode } from 'drizzle-orm/better-sqlite3';
import { drizzle as drizzleSqlJs } from 'drizzle-orm/sql-js';
import BetterSqlite3 from 'better-sqlite3';
import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import * as schema from '../../src/lib/data/schema';
import type { Db } from '../../src/lib/data/db-types';
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
import { EMBEDDED_MIGRATIONS } from '../../src/lib/data/migrations';

const DDL = EMBEDDED_MIGRATIONS.map((m) => m.sql).join('\n');

interface Driver {
  name: string;
  setup: () => Promise<DriverContext>;
}

interface DriverContext {
  db: Db;
  raw: {
    exec: (sql: string) => void;
    prepareAll: <T = unknown>(sql: string) => T[];
    prepareGet: <T = unknown>(sql: string) => T | undefined;
    insertSeason: (seriesTmdbId: number, seasonNumber: number, episodeCount: number) => number;
    insertEpisode: (
      seasonId: number,
      seriesTmdbId: number,
      seasonNumber: number,
      episodeNumber: number,
      name: string,
      airDate: string | null,
      runtime: number
    ) => void;
  };
  cleanup: () => Promise<void>;
}

const nodeDriver: Driver = {
  name: 'better-sqlite3',
  async setup(): Promise<DriverContext> {
    const sqlite = new BetterSqlite3(':memory:');
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(DDL);
    const db = drizzleNode(sqlite, { schema }) as unknown as Db;
    return {
      db,
      raw: {
        exec: (s) => sqlite.exec(s),
        prepareAll: <T>(s: string) => sqlite.prepare(s).all() as T[],
        prepareGet: <T>(s: string) => sqlite.prepare(s).get() as T | undefined,
        insertSeason: (seriesTmdbId, seasonNumber, episodeCount) => {
          const info = sqlite
            .prepare(
              'INSERT INTO seasons (series_tmdb_id, season_number, episode_count) VALUES (?, ?, ?)'
            )
            .run(seriesTmdbId, seasonNumber, episodeCount);
          return Number(info.lastInsertRowid);
        },
        insertEpisode: (
          seasonId,
          seriesTmdbId,
          seasonNumber,
          episodeNumber,
          name,
          airDate,
          runtime
        ) => {
          sqlite
            .prepare(
              `INSERT INTO episodes
                (season_id, series_tmdb_id, season_number, episode_number, name, air_date, runtime_minutes)
                VALUES (?, ?, ?, ?, ?, ?, ?)`
            )
            .run(seasonId, seriesTmdbId, seasonNumber, episodeNumber, name, airDate, runtime);
        }
      },
      cleanup: async () => {
        sqlite.close();
      }
    };
  }
};

let sqlJsStaticPromise: ReturnType<typeof initSqlJs> | null = null;
function loadSqlJsStatic() {
  if (!sqlJsStaticPromise) sqlJsStaticPromise = initSqlJs({});
  return sqlJsStaticPromise;
}

const sqlJsDriver: Driver = {
  name: 'sql.js',
  async setup(): Promise<DriverContext> {
    const SQL = await loadSqlJsStatic();
    const sqlite: SqlJsDatabase = new SQL.Database();
    sqlite.exec('PRAGMA foreign_keys = ON');
    sqlite.exec(DDL);
    const db = drizzleSqlJs(sqlite, { schema }) as unknown as Db;

    function execAll<T>(sql: string): T[] {
      const res = sqlite.exec(sql);
      if (res.length === 0) return [];
      const cols = res[0].columns;
      return res[0].values.map((row) => {
        const obj: Record<string, unknown> = {};
        cols.forEach((c, i) => (obj[c] = row[i]));
        return obj as T;
      });
    }

    return {
      db,
      raw: {
        exec: (s) => sqlite.exec(s),
        prepareAll: <T>(s: string) => execAll<T>(s),
        prepareGet: <T>(s: string) => execAll<T>(s)[0],
        insertSeason: (seriesTmdbId, seasonNumber, episodeCount) => {
          const stmt = sqlite.prepare(
            'INSERT INTO seasons (series_tmdb_id, season_number, episode_count) VALUES (?, ?, ?)'
          );
          stmt.run([seriesTmdbId, seasonNumber, episodeCount]);
          stmt.free();
          const idRow = execAll<{ id: number }>('SELECT last_insert_rowid() as id');
          return Number(idRow[0].id);
        },
        insertEpisode: (
          seasonId,
          seriesTmdbId,
          seasonNumber,
          episodeNumber,
          name,
          airDate,
          runtime
        ) => {
          const stmt = sqlite.prepare(
            `INSERT INTO episodes
                (season_id, series_tmdb_id, season_number, episode_number, name, air_date, runtime_minutes)
                VALUES (?, ?, ?, ?, ?, ?, ?)`
          );
          stmt.run([seasonId, seriesTmdbId, seasonNumber, episodeNumber, name, airDate, runtime]);
          stmt.free();
        }
      },
      cleanup: async () => {
        sqlite.close();
      }
    };
  }
};

for (const driver of [nodeDriver, sqlJsDriver]) {
  describe(`queries / mutations (${driver.name})`, () => {
    let ctx: DriverContext;

    function seedSeason(
      seriesTmdbId: number,
      seasonNumber: number,
      episodeCount: number,
      airDates: (string | null)[] = []
    ) {
      const seasonId = ctx.raw.insertSeason(seriesTmdbId, seasonNumber, episodeCount);
      for (let i = 1; i <= episodeCount; i++) {
        ctx.raw.insertEpisode(
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

      it('returns only released, unwatched episodes for followed series', async () => {
        await followSeries(ctx.db, { tmdbId: 1, name: 'A' });
        seedSeason(1, 1, 3, ['2026-05-09', '2026-05-10', '2026-05-12']);
        const rows = await getEpisodesToWatch(ctx.db, now);
        expect(rows.map((r) => r.episodeNumber)).toEqual([1, 2]);
      });

      it('hides watched episodes', async () => {
        await followSeries(ctx.db, { tmdbId: 1, name: 'A' });
        seedSeason(1, 1, 3, ['2026-05-09', '2026-05-10', '2026-05-11']);
        const epIds = ctx.raw.prepareAll<{ id: number }>(
          'SELECT id FROM episodes WHERE series_tmdb_id = 1 ORDER BY episode_number'
        );
        await markEpisodeWatched(ctx.db, epIds[1].id);
        const rows = await getEpisodesToWatch(ctx.db, now);
        expect(rows.map((r) => r.episodeNumber)).toEqual([1, 3]);
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

      it('orders by series, season, episode', async () => {
        await followSeries(ctx.db, { tmdbId: 7, name: 'Z' });
        await followSeries(ctx.db, { tmdbId: 8, name: 'A' });
        seedSeason(7, 2, 2, ['2026-05-01', '2026-05-02']);
        seedSeason(7, 1, 2, ['2026-04-01', '2026-04-02']);
        seedSeason(8, 1, 1, ['2026-05-09']);
        const rows = await getEpisodesToWatch(ctx.db, now);
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
    });
  });
}
