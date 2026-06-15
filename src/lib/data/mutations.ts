/**
 * Write-side operations. Like queries.ts, every function takes a `Db`
 * argument so it works with any synchronous Drizzle SQLite driver.
 */
import { and, eq, inArray, lt, lte, or } from 'drizzle-orm';
import type { Db } from './db-types';
import { episodes, seasons, series, settings, watched } from './schema';
import { computeReleaseAtMs, originTimeZone } from '$lib/utils/airtime';

/**
 * Upsert a settings row. Passing `value: null` stores a literal NULL —
 * which getSetting() reads back as `null`, the same shape as if the
 * row didn't exist at all. Both states are interchangeable from the
 * caller's perspective, so we don't bother deleting the row.
 */
export async function setSetting(db: Db, key: string, value: string | null): Promise<void> {
  db.insert(settings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedAt: new Date() }
    })
    .run();
}

/* Idempotent by design: re-marking an already-watched episode is a
 * no-op and DOES NOT update the existing watchedAt. The TV Time
 * importer relies on this so a second run doesn't shift the timeline
 * of episodes the user has already marked since their first import. */
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

/* Bulk-watched helpers all share the same pattern: SELECT a set of
 * episode IDs, then issue a SINGLE multi-row INSERT instead of N
 * per-episode INSERTs. The multi-row form keeps SQLite usage at one
 * statement per call (instead of N), which on the browser target also
 * means one IDB snapshot instead of N (see db.browser.ts wrapper). */
function markEpisodeIds(db: Db, ids: number[], at: Date): void {
  if (ids.length === 0) return;
  db.insert(watched)
    .values(ids.map((episodeId) => ({ episodeId, watchedAt: at })))
    .onConflictDoNothing({ target: watched.episodeId })
    .run();
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
  markEpisodeIds(db, eps.map((e) => e.id), at);
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
  if (eps.length === 0) return;
  db.delete(watched)
    .where(inArray(watched.episodeId, eps.map((e) => e.id)))
    .run();
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
  markEpisodeIds(db, eps.map((e) => e.id), at);
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
  markEpisodeIds(db, eps.map((e) => e.id), at);
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
  markEpisodeIds(db, eps.map((e) => e.id), at);
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
  isAnime?: boolean | null;
  originCountry?: string | null;
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

/* One-shot backfill of the is_anime flag for rows synced before the
 * column existed (stored NULL). The series detail loader calls this with
 * detectAnime(detail) so a legacy followed series gets reclassified the
 * first time it's opened, without waiting for a full re-sync. */
export async function setSeriesAnime(
  db: Db,
  tmdbId: number,
  isAnime: boolean
): Promise<void> {
  db.update(series).set({ isAnime }).where(eq(series.tmdbId, tmdbId)).run();
}

/* One-shot backfill of origin country + per-episode release instants for
 * rows synced before those columns existed (stored NULL). The series detail
 * loader calls this with the freshly-fetched TMDB origin_country so a legacy
 * series gets correct release-time gating the first time it's opened, without
 * waiting for a full re-sync. Mirrors the setSeriesAnime backfill pattern.
 *
 * Idempotent and cheap: when the origin is unknown there's no timezone to
 * resolve, so release_at stays NULL and the row keeps the legacy date-string
 * behaviour. */
export async function backfillSeriesReleaseTimes(
  db: Db,
  tmdbId: number,
  originCountry: string | null
): Promise<void> {
  db.update(series).set({ originCountry }).where(eq(series.tmdbId, tmdbId)).run();

  const tz = originTimeZone(originCountry);
  if (!tz) return;

  const rows = db
    .select({ id: episodes.id, airDate: episodes.airDate })
    .from(episodes)
    .where(eq(episodes.seriesTmdbId, tmdbId))
    .all();

  for (const r of rows) {
    const releaseAt = computeReleaseAtMs(r.airDate, tz);
    if (releaseAt === null) continue;
    db.update(episodes).set({ releaseAt }).where(eq(episodes.id, r.id)).run();
  }
}

/* Force-set follow timestamps. Used by the TV Time importer to
 * preserve the original "addedAt" (when the user joined the show on
 * TV Time) and to pre-mark a series as already archived. The regular
 * follow path always sets addedAt=now / removedAt=null, which is
 * correct for an interactive follow but wrong when we're back-filling
 * a multi-year history. */
export async function setSeriesFollowDates(
  db: Db,
  tmdbId: number,
  dates: { addedAt?: Date | null; removedAt?: Date | null }
): Promise<void> {
  const set: Record<string, Date | null> = {};
  if ('addedAt' in dates) set.addedAt = dates.addedAt ?? null;
  if ('removedAt' in dates) set.removedAt = dates.removedAt ?? null;
  if (Object.keys(set).length === 0) return;
  db.update(series).set(set).where(eq(series.tmdbId, tmdbId)).run();
}

/* Record that a series was (re)synced now, optionally refreshing the
 * cached structural counts. Used by the background freshness sweep: a
 * cheap tvDetail check touches `lastSyncedAt` so the series rotates out
 * of the stale set, and when a new season/episode appeared the counts
 * are updated alongside. NB: this also unfreezes `lastSyncedAt`, which
 * the original followSeries upsert never updated after the initial
 * follow. */
export async function updateSeriesSyncState(
  db: Db,
  tmdbId: number,
  syncedAt: Date,
  meta?: {
    numberOfSeasons?: number | null;
    numberOfEpisodes?: number | null;
    status?: string | null;
    lastAirDate?: string | null;
  }
): Promise<void> {
  const set: Record<string, unknown> = { lastSyncedAt: syncedAt };
  if (meta) {
    if ('numberOfSeasons' in meta) set.numberOfSeasons = meta.numberOfSeasons ?? null;
    if ('numberOfEpisodes' in meta) set.numberOfEpisodes = meta.numberOfEpisodes ?? null;
    if ('status' in meta) set.status = meta.status ?? null;
    if ('lastAirDate' in meta) set.lastAirDate = meta.lastAirDate ?? null;
  }
  db.update(series).set(set).where(eq(series.tmdbId, tmdbId)).run();
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
  releaseAt?: number | null;
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
    releaseAt: input.releaseAt ?? null,
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

/**
 * Like getEpisodeIdByCoords, but also returns the episode's air date.
 * The TV Time importer uses the air_date as a sensible fallback for
 * `watched_at` when the source row has none — otherwise null watches
 * would all land in today's history, which is incorrect.
 */
export async function getEpisodeForCoords(
  db: Db,
  seriesTmdbId: number,
  seasonNumber: number,
  episodeNumber: number
): Promise<{ id: number; airDate: string | null } | null> {
  const row = db
    .select({ id: episodes.id, airDate: episodes.airDate })
    .from(episodes)
    .where(
      and(
        eq(episodes.seriesTmdbId, seriesTmdbId),
        eq(episodes.seasonNumber, seasonNumber),
        eq(episodes.episodeNumber, episodeNumber)
      )
    )
    .all()[0];
  return row ? { id: row.id, airDate: row.airDate ?? null } : null;
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
