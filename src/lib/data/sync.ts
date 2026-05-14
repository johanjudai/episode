/**
 * TMDB → local DB synchronization helpers. Pure functions that take a `Db`
 * handle and an `apiKey`, so they work in both server and local targets.
 *
 * They are idempotent: running them multiple times is a no-op once the
 * relevant rows exist (UNIQUE indexes on (series_tmdb_id, season_number)
 * and on episode coords).
 */
import type { Db } from './db-types';
import { createTmdbClient } from './tmdb';
import {
  followSeries as followSeriesMutation,
  getEpisodeIdByCoords,
  seasonExists,
  upsertEpisode,
  upsertSeason
} from './mutations';
import { getSeries } from './queries';

export interface SyncOptions {
  /** If true, also upsert the series row (set addedAt=now, removedAt=null). */
  follow?: boolean;
  /** TMDB locale (e.g. `fr-FR`, `en-US`). Defaults to fr-FR when omitted. */
  language?: string;
  /** When true, force-overwrite existing season/episode rows even if
   *  they're already cached locally. Used after a locale switch so
   *  TMDB-localized strings (titles, overviews) replace the stale ones
   *  that were stored under the previous language. */
  refresh?: boolean;
}

/**
 * Ensure the series row exists with current addedAt and that every season
 * has its episodes synced (so the home view can list upcoming episodes).
 */
export async function syncSeriesFull(
  db: Db,
  apiKey: string,
  tmdbId: number,
  opts: SyncOptions = {}
): Promise<void> {
  const tmdb = createTmdbClient({ apiKey, language: opts.language });
  const detail = await tmdb.tvDetail(tmdbId);

  /* In refresh mode, always update the series row even if it already
   * exists, so its localized name/overview swap with the new locale. */
  const shouldUpsertSeries =
    opts.follow || opts.refresh || !(await getSeries(db, tmdbId));
  if (shouldUpsertSeries) {
    await followSeriesMutation(db, {
      tmdbId: detail.id,
      name: detail.name,
      posterPath: detail.poster_path ?? null,
      overview: detail.overview ?? null,
      firstAirDate: detail.first_air_date ?? null,
      status: detail.status ?? null,
      network: detail.networks?.[0]?.name ?? null,
      numberOfSeasons: detail.number_of_seasons ?? null,
      numberOfEpisodes: detail.number_of_episodes ?? null
    });
  }

  await Promise.all(
    (detail.seasons ?? [])
      .filter((s) => s.season_number > 0)
      .map((s) =>
        syncSeason(db, apiKey, tmdbId, s.season_number, {
          language: opts.language,
          refresh: opts.refresh
        }).catch(() => undefined)
      )
  );
}

/** Fetch a season's episodes from TMDB and insert any missing rows.
 *  In refresh mode the early `seasonExists` short-circuit is bypassed
 *  so localized titles can be overwritten. */
export async function syncSeason(
  db: Db,
  apiKey: string,
  seriesTmdbId: number,
  seasonNumber: number,
  opts: { language?: string; refresh?: boolean } = {}
): Promise<void> {
  if (!opts.refresh && (await seasonExists(db, seriesTmdbId, seasonNumber))) return;
  const tmdb = createTmdbClient({ apiKey, language: opts.language });
  const fetched = await tmdb.seasonDetail(seriesTmdbId, seasonNumber);
  const seasonId = await upsertSeason(
    db,
    {
      seriesTmdbId,
      tmdbId: fetched.id,
      seasonNumber: fetched.season_number,
      name: fetched.name ?? null,
      airDate: fetched.air_date ?? null,
      episodeCount: fetched.episodes.length,
      posterPath: fetched.poster_path ?? null
    },
    { refresh: opts.refresh }
  );
  for (const ep of fetched.episodes) {
    await upsertEpisode(
      db,
      {
        seasonId,
        seriesTmdbId,
        tmdbId: ep.id,
        seasonNumber: ep.season_number,
        episodeNumber: ep.episode_number,
        name: ep.name ?? null,
        airDate: ep.air_date ?? null,
        runtimeMinutes: ep.runtime ?? null,
        stillPath: ep.still_path ?? null
      },
      { refresh: opts.refresh }
    );
  }
}

/**
 * Ensure a single episode row exists. Used when marking an episode without
 * first having opened the series page (e.g. a mark-watched from a deep link).
 */
export async function ensureEpisodeRow(
  db: Db,
  apiKey: string,
  seriesTmdbId: number,
  seasonNumber: number,
  episodeNumber: number,
  opts: { language?: string } = {}
): Promise<number> {
  await syncSeason(db, apiKey, seriesTmdbId, seasonNumber, { language: opts.language });
  const id = await getEpisodeIdByCoords(db, seriesTmdbId, seasonNumber, episodeNumber);
  if (id === null) throw new Error('Épisode introuvable après synchronisation');
  return id;
}
