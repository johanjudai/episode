/**
 * Read-side queries. Every function takes a `Db` so it works with any
 * synchronous Drizzle SQLite driver (better-sqlite3 on the server, sql.js
 * in the browser, op-sqlite/Capacitor SQLite on mobile if we add them).
 */
import { and, asc, desc, eq, gt, isNull, lte, sql } from 'drizzle-orm';
import type { Db } from './db-types';
import type { Episode, Series } from './schema';
import { episodes, series, settings, watched } from './schema';

export async function getSetting(db: Db, key: string): Promise<string | null> {
  const rows = db.select().from(settings).where(eq(settings.key, key)).all();
  return rows[0]?.value ?? null;
}

export async function getFollowedSeries(db: Db): Promise<Series[]> {
  return db
    .select()
    .from(series)
    .where(isNull(series.removedAt))
    .orderBy(asc(series.name))
    .all();
}

export async function getEpisodesToWatch(
  db: Db,
  now: Date = new Date()
): Promise<Array<Episode & { seriesName: string; seriesPoster: string | null }>> {
  const today = now.toISOString().slice(0, 10);
  /* Single-row-per-series via window function. The previous shape
   * returned EVERY unwatched aired episode (potentially hundreds per
   * series) and de-duplicated to the first one per series in JS — a
   * 50× transfer waste on a long-running library. SQLite 3.25+
   * supports ROW_NUMBER() and both drivers (better-sqlite3 11.x,
   * sql.js 1.x) bundle a new-enough engine.
   *
   * Drizzle 0.45 doesn't have a typed builder for window functions
   * yet, so we drop down to `sql.all<T>`. The shape mirrors
   * `Episode & { seriesName, seriesPoster }` exactly. */
  const rows = db.all<{
    id: number;
    seasonId: number;
    seriesTmdbId: number;
    tmdbId: number | null;
    seasonNumber: number;
    episodeNumber: number;
    name: string | null;
    overview: string | null;
    airDate: string | null;
    runtimeMinutes: number | null;
    stillPath: string | null;
    seriesName: string;
    seriesPoster: string | null;
  }>(sql`
    SELECT
      e.id AS id,
      e.season_id AS seasonId,
      e.series_tmdb_id AS seriesTmdbId,
      e.tmdb_id AS tmdbId,
      e.season_number AS seasonNumber,
      e.episode_number AS episodeNumber,
      e.name AS name,
      e.overview AS overview,
      e.air_date AS airDate,
      e.runtime_minutes AS runtimeMinutes,
      e.still_path AS stillPath,
      s.name AS seriesName,
      s.poster_path AS seriesPoster
    FROM (
      SELECT
        episodes.*,
        ROW_NUMBER() OVER (
          PARTITION BY episodes.series_tmdb_id
          ORDER BY episodes.season_number, episodes.episode_number
        ) AS rn
      FROM episodes
      INNER JOIN series ON series.tmdb_id = episodes.series_tmdb_id
      LEFT JOIN watched ON watched.episode_id = episodes.id
      WHERE series.removed_at IS NULL
        AND watched.id IS NULL
        AND episodes.air_date IS NOT NULL
        AND episodes.air_date <= ${today}
    ) AS e
    INNER JOIN series s ON s.tmdb_id = e.series_tmdb_id
    WHERE e.rn = 1
    ORDER BY e.series_tmdb_id
  `);
  return rows as unknown as Array<Episode & { seriesName: string; seriesPoster: string | null }>;
}

export async function getUpcomingEpisodes(
  db: Db,
  daysAhead = 7,
  now: Date = new Date()
): Promise<Array<Episode & { seriesName: string }>> {
  const today = now.toISOString().slice(0, 10);
  const end = new Date(now);
  end.setDate(end.getDate() + daysAhead);
  const endIso = end.toISOString().slice(0, 10);

  return db
    .select({
      id: episodes.id,
      seasonId: episodes.seasonId,
      seriesTmdbId: episodes.seriesTmdbId,
      tmdbId: episodes.tmdbId,
      seasonNumber: episodes.seasonNumber,
      episodeNumber: episodes.episodeNumber,
      name: episodes.name,
      overview: episodes.overview,
      airDate: episodes.airDate,
      runtimeMinutes: episodes.runtimeMinutes,
      stillPath: episodes.stillPath,
      seriesName: series.name
    })
    .from(episodes)
    .innerJoin(series, eq(series.tmdbId, episodes.seriesTmdbId))
    .where(
      /* Strict `gt today` — episodes airing today belong in "À voir
       * maintenant" via getEpisodesToWatch (which uses lte today),
       * so showing them in "À venir" was double-listing. */
      and(isNull(series.removedAt), gt(episodes.airDate, today), lte(episodes.airDate, endIso))
    )
    .orderBy(asc(episodes.airDate))
    .all();
}

export async function getSeries(db: Db, tmdbId: number): Promise<Series | null> {
  const rows = db.select().from(series).where(eq(series.tmdbId, tmdbId)).all();
  return rows[0] ?? null;
}

export interface WatchedRow {
  episodeId: number;
  seriesTmdbId: number;
  watchedAt: Date;
  seriesName: string;
  seriesPoster: string | null;
  seasonNumber: number;
  episodeNumber: number;
  episodeName: string | null;
  runtimeMinutes: number | null;
}

export async function getRecentWatched(
  db: Db,
  limit = 20,
  offset = 0
): Promise<WatchedRow[]> {
  return db
    .select({
      episodeId: watched.episodeId,
      seriesTmdbId: episodes.seriesTmdbId,
      watchedAt: watched.watchedAt,
      seriesName: series.name,
      seriesPoster: series.posterPath,
      seasonNumber: episodes.seasonNumber,
      episodeNumber: episodes.episodeNumber,
      episodeName: episodes.name,
      runtimeMinutes: episodes.runtimeMinutes
    })
    .from(watched)
    .innerJoin(episodes, eq(episodes.id, watched.episodeId))
    .innerJoin(series, eq(series.tmdbId, episodes.seriesTmdbId))
    .orderBy(desc(watched.watchedAt))
    .limit(limit)
    .offset(offset)
    .all();
}

export interface FollowedSeriesProgress {
  tmdbId: number;
  name: string;
  posterPath: string | null;
  firstAirDate: string | null;
  status: string | null;
  numberOfSeasons: number | null;
  watchedCount: number;
  totalEpisodes: number;
  addedAt: Date | null;
}

export async function getFollowedSeriesWithProgress(db: Db): Promise<FollowedSeriesProgress[]> {
  /* Drizzle's `sql` template inlines column refs unqualified (e.g. "id" instead
   * of "episodes"."id"), which collides on the watched-episode join. Use raw
   * SQL strings with explicit table.column qualification in the subqueries. */
  const rows = db
    .select({
      tmdbId: series.tmdbId,
      name: series.name,
      posterPath: series.posterPath,
      firstAirDate: series.firstAirDate,
      status: series.status,
      numberOfSeasons: series.numberOfSeasons,
      addedAt: series.addedAt,
      totalEpisodes: sql<number>`(
        SELECT COUNT(*) FROM episodes
        WHERE episodes.series_tmdb_id = series.tmdb_id
      )`,
      watchedCount: sql<number>`(
        SELECT COUNT(*) FROM watched
        JOIN episodes ON episodes.id = watched.episode_id
        WHERE episodes.series_tmdb_id = series.tmdb_id
      )`
    })
    .from(series)
    .where(isNull(series.removedAt))
    .orderBy(desc(series.addedAt))
    .all();

  return rows.map((r) => ({
    ...r,
    totalEpisodes: Number(r.totalEpisodes),
    watchedCount: Number(r.watchedCount)
  }));
}

export async function getStats(db: Db): Promise<{
  totalMinutes: number;
  seriesCount: number;
  animeCount: number;
  episodesWatched: number;
}> {
  const totalRow = db
    .select({
      totalMinutes: sql<number>`COALESCE(SUM(${episodes.runtimeMinutes}), 0)`,
      episodesWatched: sql<number>`COUNT(${watched.id})`
    })
    .from(watched)
    .innerJoin(episodes, eq(episodes.id, watched.episodeId))
    .all();

  /* Split followed series into anime vs non-anime. `is_anime` is a 0/1
   * boolean; NULL (rows synced before the column existed) counts as a
   * regular series until the next sync backfills it. */
  const seriesRow = db
    .select({
      seriesCount: sql<number>`COALESCE(SUM(CASE WHEN ${series.isAnime} = 1 THEN 0 ELSE 1 END), 0)`,
      animeCount: sql<number>`COALESCE(SUM(CASE WHEN ${series.isAnime} = 1 THEN 1 ELSE 0 END), 0)`
    })
    .from(series)
    .where(isNull(series.removedAt))
    .all();

  return {
    totalMinutes: Number(totalRow[0]?.totalMinutes ?? 0),
    episodesWatched: Number(totalRow[0]?.episodesWatched ?? 0),
    seriesCount: Number(seriesRow[0]?.seriesCount ?? 0),
    animeCount: Number(seriesRow[0]?.animeCount ?? 0)
  };
}

export interface SeasonEpisodeWatched {
  seasonNumber: number;
  episodeNumber: number;
}

export async function getWatchedEpisodeKeys(
  db: Db,
  seriesTmdbId: number
): Promise<SeasonEpisodeWatched[]> {
  return db
    .select({
      seasonNumber: episodes.seasonNumber,
      episodeNumber: episodes.episodeNumber
    })
    .from(watched)
    .innerJoin(episodes, eq(episodes.id, watched.episodeId))
    .where(eq(episodes.seriesTmdbId, seriesTmdbId))
    .all();
}

export interface SeasonWithEpisodes {
  seasonNumber: number;
  name: string | null;
  airDate: string | null;
  posterPath: string | null;
  episodes: Array<{
    seasonNumber: number;
    episodeNumber: number;
    name: string | null;
    overview: string | null;
    airDate: string | null;
    runtime: number | null;
    stillPath: string | null;
  }>;
}

/**
 * Read a series' full season + episode tree from the local DB. Used by
 * the series detail loader as a cache layer to skip the N TMDB
 * `seasonDetail` round-trips when we synced this series recently
 * enough — see `series/[id]/+page.{server,ts}` for the freshness check.
 *
 * Returns null if no season has been synced yet (cold start), so the
 * caller falls back to fetching from TMDB.
 */
export async function getSeasonsWithEpisodes(
  db: Db,
  seriesTmdbId: number
): Promise<SeasonWithEpisodes[] | null> {
  /* Imported lazily to avoid a circular dep at module init. */
  const { seasons } = await import('./schema');
  const seasonRows = db
    .select()
    .from(seasons)
    .where(eq(seasons.seriesTmdbId, seriesTmdbId))
    .orderBy(asc(seasons.seasonNumber))
    .all();
  if (seasonRows.length === 0) return null;

  const episodeRows = db
    .select({
      seasonNumber: episodes.seasonNumber,
      episodeNumber: episodes.episodeNumber,
      name: episodes.name,
      overview: episodes.overview,
      airDate: episodes.airDate,
      runtimeMinutes: episodes.runtimeMinutes,
      stillPath: episodes.stillPath
    })
    .from(episodes)
    .where(eq(episodes.seriesTmdbId, seriesTmdbId))
    .orderBy(asc(episodes.seasonNumber), asc(episodes.episodeNumber))
    .all();

  const bySeason = new Map<number, SeasonWithEpisodes['episodes']>();
  for (const r of episodeRows) {
    let list = bySeason.get(r.seasonNumber);
    if (!list) {
      list = [];
      bySeason.set(r.seasonNumber, list);
    }
    list.push({
      seasonNumber: r.seasonNumber,
      episodeNumber: r.episodeNumber,
      name: r.name,
      overview: r.overview,
      airDate: r.airDate,
      runtime: r.runtimeMinutes,
      stillPath: r.stillPath
    });
  }

  return seasonRows.map((s) => ({
    seasonNumber: s.seasonNumber,
    name: s.name,
    airDate: s.airDate,
    posterPath: s.posterPath,
    episodes: bySeason.get(s.seasonNumber) ?? []
  }));
}
