import type { Actions, PageServerLoad } from './$types';
import { error, fail } from '@sveltejs/kit';
import { z } from 'zod';
import { createTmdbClient } from '$lib/server/tmdb';
import {
  followSeries,
  getSeries,
  getSetting,
  markEpisodeWatched,
  markSeasonWatched,
  markSeriesWatched,
  unfollowSeries,
  unmarkEpisodeWatched
} from '$lib/server/db/queries';
import { db, episodes, seasons, watched } from '$lib/server/db';
import { and, eq } from 'drizzle-orm';

export const load: PageServerLoad = async ({ params }) => {
  const id = Number(params.id);
  if (!Number.isFinite(id)) throw error(404, 'Série introuvable');

  const apiKey = (await getSetting('tmdb.api_key')) ?? process.env.EPISODE_TMDB_API_KEY ?? '';
  if (!apiKey) {
    throw error(412, 'Clé TMDB manquante. Configurez-la dans les paramètres.');
  }

  const tmdb = createTmdbClient({ apiKey });
  const detail = await tmdb.tvDetail(id);
  const followed = await getSeries(id);

  const seasonNumbers = (detail.seasons ?? [])
    .filter((s) => s.season_number > 0)
    .map((s) => s.season_number);

  const fetchedSeasons = await Promise.all(seasonNumbers.map((n) => tmdb.seasonDetail(id, n)));

  const watchedIds = new Set<string>();
  if (followed) {
    const w = db
      .select({ s: episodes.seasonNumber, e: episodes.episodeNumber })
      .from(watched)
      .innerJoin(episodes, eq(episodes.id, watched.episodeId))
      .where(eq(episodes.seriesTmdbId, id))
      .all();
    for (const row of w) watchedIds.add(`${row.s}-${row.e}`);
  }

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
      watched: watchedIds.has(`${ep.season_number}-${ep.episode_number}`)
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
    followed: !!followed,
    progress: { watched: watchedCount, total: totalEpisodes }
  };
};

const SeasonForm = z.object({ seasonNumber: z.coerce.number().int().positive() });
const EpisodeForm = z.object({
  seasonNumber: z.coerce.number().int().nonnegative(),
  episodeNumber: z.coerce.number().int().nonnegative(),
  watched: z.enum(['true', 'false'])
});

async function syncSeasonsToDb(tmdbId: number): Promise<void> {
  // No-op stub. Real sync happens when episodes are marked.
}

async function ensureEpisodeRow(
  tmdbId: number,
  seasonNumber: number,
  episodeNumber: number,
  apiKey: string
): Promise<number> {
  const tmdb = createTmdbClient({ apiKey });

  let seasonRow = db
    .select()
    .from(seasons)
    .where(and(eq(seasons.seriesTmdbId, tmdbId), eq(seasons.seasonNumber, seasonNumber)))
    .all()[0];

  if (!seasonRow) {
    const fetched = await tmdb.seasonDetail(tmdbId, seasonNumber);
    db.insert(seasons)
      .values({
        seriesTmdbId: tmdbId,
        tmdbId: fetched.id,
        seasonNumber: fetched.season_number,
        name: fetched.name ?? null,
        airDate: fetched.air_date ?? null,
        episodeCount: fetched.episodes.length,
        posterPath: fetched.poster_path ?? null
      })
      .onConflictDoNothing()
      .run();
    seasonRow = db
      .select()
      .from(seasons)
      .where(and(eq(seasons.seriesTmdbId, tmdbId), eq(seasons.seasonNumber, seasonNumber)))
      .all()[0]!;
    for (const ep of fetched.episodes) {
      db.insert(episodes)
        .values({
          seasonId: seasonRow.id,
          seriesTmdbId: tmdbId,
          tmdbId: ep.id,
          seasonNumber: ep.season_number,
          episodeNumber: ep.episode_number,
          name: ep.name ?? null,
          airDate: ep.air_date ?? null,
          runtimeMinutes: ep.runtime ?? null,
          stillPath: ep.still_path ?? null
        })
        .onConflictDoNothing()
        .run();
    }
  }

  const epRow = db
    .select({ id: episodes.id })
    .from(episodes)
    .where(
      and(
        eq(episodes.seriesTmdbId, tmdbId),
        eq(episodes.seasonNumber, seasonNumber),
        eq(episodes.episodeNumber, episodeNumber)
      )
    )
    .all()[0];

  if (!epRow) throw new Error('Épisode introuvable après synchronisation');
  return epRow.id;
}

export const actions: Actions = {
  follow: async ({ params }) => {
    const id = Number(params.id);
    const apiKey = (await getSetting('tmdb.api_key')) ?? process.env.EPISODE_TMDB_API_KEY ?? '';
    if (!apiKey) return fail(412, { error: 'Clé TMDB manquante' });
    const tmdb = createTmdbClient({ apiKey });
    const detail = await tmdb.tvDetail(id);
    await followSeries({
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
    return { success: true };
  },
  unfollow: async ({ params }) => {
    const id = Number(params.id);
    await unfollowSeries(id);
    return { success: true };
  },
  markEpisode: async ({ params, request }) => {
    const id = Number(params.id);
    const apiKey = (await getSetting('tmdb.api_key')) ?? process.env.EPISODE_TMDB_API_KEY ?? '';
    if (!apiKey) return fail(412, { error: 'Clé TMDB manquante' });
    const form = await request.formData();
    const parsed = EpisodeForm.safeParse(Object.fromEntries(form));
    if (!parsed.success) return fail(400, { error: 'Données invalides' });
    const epId = await ensureEpisodeRow(
      id,
      parsed.data.seasonNumber,
      parsed.data.episodeNumber,
      apiKey
    );
    if (parsed.data.watched === 'true') await markEpisodeWatched(epId);
    else await unmarkEpisodeWatched(epId);
    return { success: true };
  },
  markSeason: async ({ params, request }) => {
    const id = Number(params.id);
    const apiKey = (await getSetting('tmdb.api_key')) ?? process.env.EPISODE_TMDB_API_KEY ?? '';
    if (!apiKey) return fail(412, { error: 'Clé TMDB manquante' });
    const form = await request.formData();
    const parsed = SeasonForm.safeParse(Object.fromEntries(form));
    if (!parsed.success) return fail(400, { error: 'Saison invalide' });
    // Pre-sync season into DB
    await ensureEpisodeRow(id, parsed.data.seasonNumber, 1, apiKey).catch(() => 0);
    await markSeasonWatched(id, parsed.data.seasonNumber);
    return { success: true };
  },
  markAll: async ({ params }) => {
    const id = Number(params.id);
    const apiKey = (await getSetting('tmdb.api_key')) ?? process.env.EPISODE_TMDB_API_KEY ?? '';
    if (!apiKey) return fail(412, { error: 'Clé TMDB manquante' });
    const tmdb = createTmdbClient({ apiKey });
    const detail = await tmdb.tvDetail(id);
    for (const s of detail.seasons ?? []) {
      if (s.season_number > 0) {
        await ensureEpisodeRow(id, s.season_number, 1, apiKey).catch(() => 0);
      }
    }
    await markSeriesWatched(id);
    return { success: true };
  }
};
