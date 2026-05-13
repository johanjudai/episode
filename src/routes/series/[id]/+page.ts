import type { PageLoad } from './$types';
import { browser } from '$app/environment';
import { error } from '@sveltejs/kit';
import { IS_LOCAL } from '$lib/config';

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
  const { getSeries, getSetting, getWatchedEpisodeKeys } = await import('$lib/data/queries');
  const { createTmdbClient } = await import('$lib/data/tmdb');
  const { fetchSeriesRatings } = await import('$lib/data/ratings');

  const db = await getDb();
  const apiKey = await getSetting(db, 'tmdb.api_key');
  if (!apiKey) throw error(412, 'Clé TMDB manquante. Configurez-la dans les paramètres.');

  const omdbKey = await getSetting(db, 'omdb.api_key');

  const tmdb = createTmdbClient({ apiKey });
  const detail = await tmdb.tvDetail(id);
  const followed = await getSeries(db, id);

  const seasonNumbers = (detail.seasons ?? [])
    .filter((s) => s.season_number > 0)
    .map((s) => s.season_number);

  const fetchedSeasons = await Promise.all(seasonNumbers.map((n) => tmdb.seasonDetail(id, n)));

  const watchedKeys = followed ? await getWatchedEpisodeKeys(db, id) : [];
  const watchedSet = new Set(watchedKeys.map((k) => `${k.seasonNumber}-${k.episodeNumber}`));

  const seasonsOut = fetchedSeasons.map((s) => ({
    seasonNumber: s.season_number,
    name: s.name ?? `Saison ${s.season_number}`,
    airDate: s.air_date ?? null,
    posterPath: s.poster_path ?? null,
    episodes: s.episodes.map((ep) => ({
      seasonNumber: ep.season_number,
      episodeNumber: ep.episode_number,
      name: ep.name ?? null,
      airDate: ep.air_date ?? null,
      runtime: ep.runtime ?? null,
      watched: watchedSet.has(`${ep.season_number}-${ep.episode_number}`)
    }))
  }));

  const totalEpisodes = seasonsOut.reduce((acc, s) => acc + s.episodes.length, 0);
  const watchedCount = seasonsOut.reduce(
    (acc, s) => acc + s.episodes.filter((e) => e.watched).length,
    0
  );

  const ratings = await fetchSeriesRatings({
    tmdbId: id,
    tmdbApiKey: apiKey,
    omdbApiKey: omdbKey,
    tmdbVote:
      typeof detail.vote_average === 'number' && detail.vote_average > 0
        ? { average: detail.vote_average, count: detail.vote_count ?? 0 }
        : null
  });

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
    ratings
  };
};
