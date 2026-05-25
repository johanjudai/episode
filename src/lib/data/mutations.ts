/**
 * Write-side operations. Like queries.ts, every function takes a `Db`
 * argument so it works with any synchronous Drizzle SQLite driver.
 *
 * `setSetting(db, key, null)` deletes the key (instead of storing a NULL
 * value) so that `getSetting` returns `null` for unset keys consistently.
 */
import { and, eq, lt, lte, or } from 'drizzle-orm';
import type { Db } from './db-types';
import { episodes, seasons, series, settings, watched } from './schema';

export async function setSetting(db: Db, key: string, value: string | null): Promise<void> {
  db.insert(settings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedAt: new Date() }
    })
    .run();
}

export async function markEpisodeWatched(
  db: Db,
  episodeId: number,
  at: Date = new Date()
): Promise<void> {
  db.insert(watched)
    .values({ episodeId, watchedAt: at })
    .onConflictDoNothing({ target: watched.episodeId })
    .run();
}

export async function unmarkEpisodeWatched(db: Db, episodeId: number): Promise<void> {
  db.delete(watched).where(eq(watched.episodeId, episodeId)).run();
}

export async function markSeasonWatched(
  db: Db,
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

export async function unmarkSeasonWatched(
  db: Db,
  seriesTmdbId: number,
  seasonNumber: number
): Promise<void> {
  const eps = db
    .select({ id: episodes.id })
    .from(episodes)
    .where(
      and(eq(episodes.seriesTmdbId, seriesTmdbId), eq(episodes.seasonNumber, seasonNumber))
    )
    .all();
  for (const ep of eps) {
    db.delete(watched).where(eq(watched.episodeId, ep.id)).run();
  }
}

export async function markEpisodesUpTo(
  db: Db,
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
  db: Db,
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

export async function markSeriesWatched(
  db: Db,
  seriesTmdbId: number,
  at: Date = new Date()
): Promise<void> {
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

export interface FollowSeriesInput {
  tmdbId: number;
  name: string;
  posterPath?: string | null;
  overview?: string | null;
  firstAirDate?: string | null;
  status?: string | null;
  network?: string | null;
  numberOfSeasons?: number | null;
  numberOfEpisodes?: number | null;
}

export async function followSeries(db: Db, seriesData: FollowSeriesInput): Promise<void> {
  const now = new Date();
  db.insert(series)
    .values({ ...seriesData, addedAt: now, removedAt: null, lastSyncedAt: now })
    .onConflictDoUpdate({
      target: series.tmdbId,
      set: { ...seriesData, addedAt: now, removedAt: null }
    })
    .run();
}

export async function unfollowSeries(db: Db, tmdbId: number): Promise<void> {
  db.update(series).set({ removedAt: new Date() }).where(eq(series.tmdbId, tmdbId)).run();
}

export interface UpsertSeasonInput {
  seriesTmdbId: number;
  tmdbId?: number | null;
  seasonNumber: number;
  name?: string | null;
  overview?: string | null;
  airDate?: string | null;
  episodeCount?: number | null;
  posterPath?: string | null;
}

export async function upsertSeason(
  db: Db,
  input: UpsertSeasonInput,
  opts: { refresh?: boolean } = {}
): Promise<number> {
  const values = {
    seriesTmdbId: input.seriesTmdbId,
    tmdbId: input.tmdbId ?? null,
    seasonNumber: input.seasonNumber,
    name: input.name ?? null,
    overview: input.overview ?? null,
    airDate: input.airDate ?? null,
    episodeCount: input.episodeCount ?? null,
    posterPath: input.posterPath ?? null
  };
  /* In refresh mode (locale change re-sync) update the row instead of
   * skipping the conflict — that's the only way the localized name,
   * air_date and poster swap when the user toggles fr ↔ en. The
   * default path stays no-op-on-conflict so a routine ensure-row from
   * markEpisode doesn't burn an extra WRITE per call. */
  if (opts.refresh) {
    db.insert(seasons)
      .values(values)
      .onConflictDoUpdate({
        target: [seasons.seriesTmdbId, seasons.seasonNumber],
        set: values
      })
      .run();
  } else {
    db.insert(seasons).values(values).onConflictDoNothing().run();
  }

  const row = db
    .select({ id: seasons.id })
    .from(seasons)
    .where(
      and(
        eq(seasons.seriesTmdbId, input.seriesTmdbId),
        eq(seasons.seasonNumber, input.seasonNumber)
      )
    )
    .all()[0];

  if (!row) throw new Error('Season upsert failed');
  return row.id;
}

export interface UpsertEpisodeInput {
  seasonId: number;
  seriesTmdbId: number;
  tmdbId?: number | null;
  seasonNumber: number;
  episodeNumber: number;
  name?: string | null;
  overview?: string | null;
  airDate?: string | null;
  runtimeMinutes?: number | null;
  stillPath?: string | null;
}

export async function upsertEpisode(
  db: Db,
  input: UpsertEpisodeInput,
  opts: { refresh?: boolean } = {}
): Promise<void> {
  const values = {
    seasonId: input.seasonId,
    seriesTmdbId: input.seriesTmdbId,
    tmdbId: input.tmdbId ?? null,
    seasonNumber: input.seasonNumber,
    episodeNumber: input.episodeNumber,
    name: input.name ?? null,
    overview: input.overview ?? null,
    airDate: input.airDate ?? null,
    runtimeMinutes: input.runtimeMinutes ?? null,
    stillPath: input.stillPath ?? null
  };
  if (opts.refresh) {
    db.insert(episodes)
      .values(values)
      .onConflictDoUpdate({
        target: [episodes.seriesTmdbId, episodes.seasonNumber, episodes.episodeNumber],
        set: values
      })
      .run();
  } else {
    db.insert(episodes).values(values).onConflictDoNothing().run();
  }
}

export async function getEpisodeIdByCoords(
  db: Db,
  seriesTmdbId: number,
  seasonNumber: number,
  episodeNumber: number
): Promise<number | null> {
  const row = db
    .select({ id: episodes.id })
    .from(episodes)
    .where(
      and(
        eq(episodes.seriesTmdbId, seriesTmdbId),
        eq(episodes.seasonNumber, seasonNumber),
        eq(episodes.episodeNumber, episodeNumber)
      )
    )
    .all()[0];
  return row?.id ?? null;
}

export async function seasonExists(
  db: Db,
  seriesTmdbId: number,
  seasonNumber: number
): Promise<boolean> {
  const row = db
    .select({ id: seasons.id })
    .from(seasons)
    .where(and(eq(seasons.seriesTmdbId, seriesTmdbId), eq(seasons.seasonNumber, seasonNumber)))
    .all()[0];
  return !!row;
}
