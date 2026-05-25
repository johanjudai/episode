import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { IS_LOCAL } from '$lib/config';
import { tmdbLanguageFromStored } from '$lib/i18n';
import type { SeriesRatings } from '$lib/data/ratings';

const emptyRatings: SeriesRatings = { tmdb: null, external: [] };

export const load: PageServerLoad = async ({ params }) => {
  const id = Number(params.id);
  if (!Number.isFinite(id)) throw error(404, 'Série introuvable');

  /* Local target: the universal +page.ts handles everything client-side. */
  if (IS_LOCAL) {
    return {
      series: null as null | {
        tmdbId: number;
        name: string;
        overview: string;
        posterPath: string | null;
        firstAirDate: string | null;
        status: string | null;
        network: string | null;
        numberOfSeasons: number | null;
        numberOfEpisodes: number;
        runtimeMinutes: number | null;
      },
      seasons: [] as Array<{
        seasonNumber: number;
        name: string;
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
          watched: boolean;
        }>;
      }>,
      followed: false,
      progress: { watched: 0, total: 0 },
      ratings: emptyRatings,
      trailer: null as null | { youtubeKey: string; name: string | null }
    };
  }

  const { serverDb } = await import('$lib/server/db');
  const { getSeasonsWithEpisodes, getSeries, getSetting, getWatchedEpisodeKeys } =
    await import('$lib/data/queries');
  const { getOmdbKey, getTmdbKey } = await import('$lib/server/api-helpers');
  const { createTmdbClient, pickBestTrailer } = await import('$lib/data/tmdb');
  const { fetchSeriesRatings } = await import('$lib/data/ratings');

  const [effectiveKey, effectiveOmdbKey, storedLocale] = await Promise.all([
    getTmdbKey(serverDb),
    getOmdbKey(serverDb),
    getSetting(serverDb, 'locale')
  ]);
  if (!effectiveKey) throw error(412, 'Clé TMDB manquante. Configurez-la dans les paramètres.');
  const language = tmdbLanguageFromStored(storedLocale);
  const tmdb = createTmdbClient({ apiKey: effectiveKey, language });
  const detail = await tmdb.tvDetail(id);
  const followed = await getSeries(serverDb, id);

  /* Freshness window: if the followed series was synced within the
   * last 7 days, skip the N TMDB seasonDetail round-trips and build
   * the season tree from the local DB instead. A 21-season show
   * (Grey's, NCIS) goes from 22 TMDB calls to 1 here. The next
   * mark/unmark mutation will trigger an ensureEpisodeRow that picks
   * up newly-aired episodes. */
  const FRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
  const lastSyncedMs = followed?.lastSyncedAt ? followed.lastSyncedAt.getTime() : 0;
  const isFresh = !!followed && Date.now() - lastSyncedMs < FRESH_WINDOW_MS;

  const cached = isFresh ? await getSeasonsWithEpisodes(serverDb, id) : null;

  const watchedKeys = followed ? await getWatchedEpisodeKeys(serverDb, id) : [];
  const watchedSet = new Set(watchedKeys.map((k) => `${k.seasonNumber}-${k.episodeNumber}`));

  let seasonsOut: Array<{
    seasonNumber: number;
    name: string;
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
      watched: boolean;
    }>;
  }>;

  if (cached) {
    seasonsOut = cached.map((s) => ({
      seasonNumber: s.seasonNumber,
      name: s.name ?? `Saison ${s.seasonNumber}`,
      airDate: s.airDate,
      posterPath: s.posterPath,
      episodes: s.episodes.map((ep) => ({
        ...ep,
        watched: watchedSet.has(`${ep.seasonNumber}-${ep.episodeNumber}`)
      }))
    }));
  } else {
    const seasonNumbers = (detail.seasons ?? [])
      .filter((s) => s.season_number > 0)
      .map((s) => s.season_number);
    const fetchedSeasons = await Promise.all(seasonNumbers.map((n) => tmdb.seasonDetail(id, n)));
    seasonsOut = fetchedSeasons.map((s) => ({
      seasonNumber: s.season_number,
      name: s.name ?? `Saison ${s.season_number}`,
      airDate: s.air_date ?? null,
      posterPath: s.poster_path ?? null,
      episodes: s.episodes.map((ep) => ({
        seasonNumber: ep.season_number,
        episodeNumber: ep.episode_number,
        name: ep.name ?? null,
        overview: ep.overview ?? null,
        airDate: ep.air_date ?? null,
        runtime: ep.runtime ?? null,
        stillPath: ep.still_path ?? null,
        watched: watchedSet.has(`${ep.season_number}-${ep.episode_number}`)
      }))
    }));
  }

  const totalEpisodes = seasonsOut.reduce((acc, s) => acc + s.episodes.length, 0);
  const watchedCount = seasonsOut.reduce(
    (acc, s) => acc + s.episodes.filter((e) => e.watched).length,
    0
  );

  /* Ratings: pass the TMDB detail we already fetched so the aggregator
   * skips an extra /tv/{id} round-trip and has the genres / origin
   * fields it needs for anime detection. */
  const ratings = await fetchSeriesRatings({
    tmdbId: id,
    tmdbApiKey: effectiveKey,
    omdbApiKey: effectiveOmdbKey,
    tmdbDetail: detail
  });

  /* Trailer is optional — silently fall back to null if /videos errors
   * out (TMDB sometimes throttles auxiliary endpoints first). The hero
   * still renders, the cover just isn't clickable. */
  const trailer = await tmdb
    .videos(id)
    .then((v) => pickBestTrailer(v.results))
    .catch(() => null);

  return {
    series: {
      tmdbId: detail.id,
      name: detail.name,
      overview: detail.overview ?? '',
      posterPath: detail.poster_path ?? null,
      firstAirDate: detail.first_air_date ?? null,
      status: detail.status ?? null,
      network: detail.networks?.[0]?.name ?? null,
      numberOfSeasons: detail.number_of_seasons ?? null,
      numberOfEpisodes: detail.number_of_episodes ?? totalEpisodes,
      runtimeMinutes: detail.episode_run_time?.[0] ?? null
    },
    seasons: seasonsOut,
    followed: !!followed && !followed.removedAt,
    progress: { watched: watchedCount, total: totalEpisodes },
    ratings,
    trailer
  };
};
