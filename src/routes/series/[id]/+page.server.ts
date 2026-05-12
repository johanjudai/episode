import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { IS_LOCAL } from '$lib/config';

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
          airDate: string | null;
          runtime: number | null;
          watched: boolean;
        }>;
      }>,
      followed: false,
      progress: { watched: 0, total: 0 }
    };
  }

  const { serverDb } = await import('$lib/server/db');
  const { getSeries, getSetting, getWatchedEpisodeKeys } = await import('$lib/data/queries');
  const { createTmdbClient } = await import('$lib/data/tmdb');

  const apiKey =
    (await getSetting(serverDb, 'tmdb.api_key')) ?? process.env.EPISODE_TMDB_API_KEY ?? '';
  if (!apiKey) throw error(412, 'Clé TMDB manquante. Configurez-la dans les paramètres.');

  const tmdb = createTmdbClient({ apiKey });
  const detail = await tmdb.tvDetail(id);
  const followed = await getSeries(serverDb, id);

  const seasonNumbers = (detail.seasons ?? [])
    .filter((s) => s.season_number > 0)
    .map((s) => s.season_number);

  const fetchedSeasons = await Promise.all(seasonNumbers.map((n) => tmdb.seasonDetail(id, n)));

  const watchedKeys = followed ? await getWatchedEpisodeKeys(serverDb, id) : [];
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
    progress: { watched: watchedCount, total: totalEpisodes }
  };
};
