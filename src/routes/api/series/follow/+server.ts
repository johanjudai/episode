import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { serverDb } from '$lib/server/db';
import { getSetting } from '$lib/data/queries';
import { syncSeriesFull } from '$lib/data/sync';
import type { RequestHandler } from './$types';

const Body = z.object({ seriesTmdbId: z.number().int().positive() });

export const POST: RequestHandler = async ({ request }) => {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw error(400, 'Invalid series id');
  const apiKey =
    (await getSetting(serverDb, 'tmdb.api_key')) ?? process.env.EPISODE_TMDB_API_KEY ?? '';
  if (!apiKey) throw error(412, 'Clé TMDB manquante');
  await syncSeriesFull(serverDb, apiKey, parsed.data.seriesTmdbId, { follow: true });
  return json({ ok: true });
};
