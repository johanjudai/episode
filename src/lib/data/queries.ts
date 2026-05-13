/**
 * Read-side queries. Every function takes a `Db` so it works with any
 * synchronous Drizzle SQLite driver (better-sqlite3 on the server, sql.js
 * in the browser, op-sqlite/Capacitor SQLite on mobile if we add them).
 */
import { and, asc, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
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
      seriesName: series.name,
      seriesPoster: series.posterPath
    })
    .from(episodes)
    .innerJoin(series, eq(series.tmdbId, episodes.seriesTmdbId))
    .leftJoin(watched, eq(watched.episodeId, episodes.id))
    .where(
      and(
        isNull(series.removedAt),
        isNull(watched.id),
        lte(episodes.airDate, today),
        sql`${episodes.airDate} IS NOT NULL`
      )
    )
    /* sort by series → season → episode so the JS-side dedupe picks the
     * earliest unwatched episode per series */
    .orderBy(
      asc(episodes.seriesTmdbId),
      asc(episodes.seasonNumber),
      asc(episodes.episodeNumber)
    )
    .all();
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
      and(isNull(series.removedAt), gte(episodes.airDate, today), lte(episodes.airDate, endIso))
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

  const seriesRow = db
    .select({ count: sql<number>`COUNT(*)` })
    .from(series)
    .where(isNull(series.removedAt))
    .all();

  return {
    totalMinutes: Number(totalRow[0]?.totalMinutes ?? 0),
    episodesWatched: Number(totalRow[0]?.episodesWatched ?? 0),
    seriesCount: Number(seriesRow[0]?.count ?? 0)
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
