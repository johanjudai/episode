import { db, settings, series, seasons, episodes, watched } from './index';
import type { Series, Episode } from './index';
import { and, asc, desc, eq, gte, isNull, lt, lte, or, sql } from 'drizzle-orm';

export async function getSetting(key: string): Promise<string | null> {
  const rows = db.select().from(settings).where(eq(settings.key, key)).all();
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string | null): Promise<void> {
  db.insert(settings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedAt: new Date() }
    })
    .run();
}

export async function getFollowedSeries(): Promise<Series[]> {
  return db
    .select()
    .from(series)
    .where(isNull(series.removedAt))
    .orderBy(asc(series.name))
    .all();
}

export async function getEpisodesToWatch(now: Date = new Date()): Promise<
  Array<Episode & { seriesName: string; seriesPoster: string | null }>
> {
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
    .orderBy(asc(episodes.airDate))
    .all();
}

export async function getUpcomingEpisodes(daysAhead = 7, now: Date = new Date()): Promise<
  Array<Episode & { seriesName: string }>
> {
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

export async function markEpisodeWatched(episodeId: number, at: Date = new Date()): Promise<void> {
  db.insert(watched)
    .values({ episodeId, watchedAt: at })
    .onConflictDoNothing({ target: watched.episodeId })
    .run();
}

export async function unmarkEpisodeWatched(episodeId: number): Promise<void> {
  db.delete(watched).where(eq(watched.episodeId, episodeId)).run();
}

export async function markSeasonWatched(
  seriesTmdbId: number,
  seasonNumber: number,
  at: Date = new Date()
): Promise<void> {
  const eps = db
    .select({ id: episodes.id })
    .from(episodes)
    .where(
      and(eq(episodes.seriesTmdbId, seriesTmdbId), eq(episodes.seasonNumber, seasonNumber))
    )
    .all();
  for (const ep of eps) {
    db.insert(watched)
      .values({ episodeId: ep.id, watchedAt: at })
      .onConflictDoNothing({ target: watched.episodeId })
      .run();
  }
}

export async function markEpisodesUpTo(
  seriesTmdbId: number,
  seasonNumber: number,
  episodeNumber: number,
  at: Date = new Date()
): Promise<void> {
  const eps = db
    .select({ id: episodes.id })
    .from(episodes)
    .where(
      and(
        eq(episodes.seriesTmdbId, seriesTmdbId),
        or(
          lt(episodes.seasonNumber, seasonNumber),
          and(
            eq(episodes.seasonNumber, seasonNumber),
            lte(episodes.episodeNumber, episodeNumber)
          )
        )
      )
    )
    .all();
  for (const ep of eps) {
    db.insert(watched)
      .values({ episodeId: ep.id, watchedAt: at })
      .onConflictDoNothing({ target: watched.episodeId })
      .run();
  }
}

export async function markSeasonsUpTo(
  seriesTmdbId: number,
  seasonNumber: number,
  at: Date = new Date()
): Promise<void> {
  const eps = db
    .select({ id: episodes.id })
    .from(episodes)
    .where(
      and(eq(episodes.seriesTmdbId, seriesTmdbId), lte(episodes.seasonNumber, seasonNumber))
    )
    .all();
  for (const ep of eps) {
    db.insert(watched)
      .values({ episodeId: ep.id, watchedAt: at })
      .onConflictDoNothing({ target: watched.episodeId })
      .run();
  }
}

export async function markSeriesWatched(seriesTmdbId: number, at: Date = new Date()): Promise<void> {
  const eps = db
    .select({ id: episodes.id })
    .from(episodes)
    .where(eq(episodes.seriesTmdbId, seriesTmdbId))
    .all();
  for (const ep of eps) {
    db.insert(watched)
      .values({ episodeId: ep.id, watchedAt: at })
      .onConflictDoNothing({ target: watched.episodeId })
      .run();
  }
}

export async function followSeries(seriesData: {
  tmdbId: number;
  name: string;
  posterPath?: string | null;
  overview?: string | null;
  firstAirDate?: string | null;
  status?: string | null;
  network?: string | null;
  numberOfSeasons?: number | null;
  numberOfEpisodes?: number | null;
}): Promise<void> {
  const now = new Date();
  db.insert(series)
    .values({ ...seriesData, addedAt: now, removedAt: null, lastSyncedAt: now })
    .onConflictDoUpdate({
      target: series.tmdbId,
      set: { ...seriesData, addedAt: now, removedAt: null }
    })
    .run();
}

export async function unfollowSeries(tmdbId: number): Promise<void> {
  db.update(series).set({ removedAt: new Date() }).where(eq(series.tmdbId, tmdbId)).run();
}

export async function getSeries(tmdbId: number): Promise<Series | null> {
  const rows = db.select().from(series).where(eq(series.tmdbId, tmdbId)).all();
  return rows[0] ?? null;
}

export async function getRecentWatched(limit = 20): Promise<
  Array<{
    episodeId: number;
    watchedAt: Date;
    seriesName: string;
    seasonNumber: number;
    episodeNumber: number;
    episodeName: string | null;
    runtimeMinutes: number | null;
  }>
> {
  return db
    .select({
      episodeId: watched.episodeId,
      watchedAt: watched.watchedAt,
      seriesName: series.name,
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
    .all();
}

export async function getStats(): Promise<{
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
