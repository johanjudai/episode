import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { serverDb } from '$lib/server/db';
import { getSeries, getSetting } from '$lib/data/queries';
import { syncSeason, syncSeriesFull } from '$lib/data/sync';
import { markSeasonsUpTo, markSeasonWatched, unmarkSeasonWatched } from '$lib/data/mutations';
import type { RequestHandler } from './$types';

const Body = z.object({
  seriesTmdbId: z.number().int().positive(),
  seasonNumber: z.number().int().positive(),
  watched: z.boolean(),
  markPrevious: z.boolean().optional()
});

export const POST: RequestHandler = async ({ request }) => {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw error(400, 'Invalid payload');
  const apiKey =
    (await getSetting(serverDb, 'tmdb.api_key')) ?? process.env.EPISODE_TMDB_API_KEY ?? '';

  if (!parsed.data.watched) {
    await unmarkSeasonWatched(serverDb, parsed.data.seriesTmdbId, parsed.data.seasonNumber);
    return json({ ok: true });
  }

  if (!apiKey) throw error(412, 'Clé TMDB manquante');

  const existing = await getSeries(serverDb, parsed.data.seriesTmdbId);
  if (!existing || existing.removedAt) {
    await syncSeriesFull(serverDb, apiKey, parsed.data.seriesTmdbId, { follow: true });
  }
  await syncSeason(serverDb, apiKey, parsed.data.seriesTmdbId, parsed.data.seasonNumber).catch(
    () => undefined
  );

  if (parsed.data.markPrevious) {
    await markSeasonsUpTo(serverDb, parsed.data.seriesTmdbId, parsed.data.seasonNumber);
  } else {
    await markSeasonWatched(serverDb, parsed.data.seriesTmdbId, parsed.data.seasonNumber);
  }
  return json({ ok: true });
};
