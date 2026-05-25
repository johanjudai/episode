import type { PageLoad } from './$types';
import { browser } from '$app/environment';
import { error } from '@sveltejs/kit';
import { IS_LOCAL } from '$lib/config';
import { tmdbLanguageFromStored } from '$lib/i18n';

export const load: PageLoad = async ({ data, params }) => {
  if (!IS_LOCAL) return { ...data };
  /* Local target — load TMDB + watched state in the browser. */
  const id = Number(params.id);
  if (!Number.isFinite(id)) throw error(404, 'Série introuvable');

  /* During prerender (Node, no browser), return a placeholder; the SPA shell
   * will re-run this on the client where `browser === true`. */
  if (!browser) {
    return { ...data };
  }

  const { getDb } = await import('$lib/db');
  const { getSeasonsWithEpisodes, getSeries, getSetting, getWatchedEpisodeKeys } =
    await import('$lib/data/queries');
  const { createTmdbClient, pickBestTrailer } = await import('$lib/data/tmdb');
  const { fetchSeriesRatings } = await import('$lib/data/ratings');

  const db = await getDb();
  const [apiKey, omdbKey, storedLocale] = await Promise.all([
    getSetting(db, 'tmdb.api_key'),
    getSetting(db, 'omdb.api_key'),
    getSetting(db, 'locale')
  ]);
  if (!apiKey) throw error(412, 'Clé TMDB manquante. Configurez-la dans les paramètres.');

  const language = tmdbLanguageFromStored(storedLocale);
  const tmdb = createTmdbClient({ apiKey, language });
  const detail = await tmdb.tvDetail(id);
  const followed = await getSeries(db, id);

  /* See server loader: skip per-season TMDB fetches when the local
   * sync is < 7 days old. Same cache window in both targets. */
  const FRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
  const lastSyncedMs = followed?.lastSyncedAt ? followed.lastSyncedAt.getTime() : 0;
  const isFresh = !!followed && Date.now() - lastSyncedMs < FRESH_WINDOW_MS;

  const cached = isFresh ? await getSeasonsWithEpisodes(db, id) : null;

  const watchedKeys = followed ? await getWatchedEpisodeKeys(db, id) : [];
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

  const ratings = await fetchSeriesRatings({
    tmdbId: id,
    tmdbApiKey: apiKey,
    omdbApiKey: omdbKey,
    tmdbDetail: detail
  });

  /* Optional trailer fetch — failure is silent. */
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
