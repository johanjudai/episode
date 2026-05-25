import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { serverDb } from '$lib/server/db';
import { requireTmdbKey } from '$lib/server/api-helpers';
import { markSeriesWatched } from '$lib/data/mutations';
import { syncSeriesFull } from '$lib/data/sync';
import type { RequestHandler } from './$types';

const Body = z.object({ seriesTmdbId: z.number().int().positive() });

export const POST: RequestHandler = async ({ request }) => {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw error(400, 'Invalid payload');
  const apiKey = await requireTmdbKey(serverDb);
  await syncSeriesFull(serverDb, apiKey, parsed.data.seriesTmdbId, { follow: true });
  await markSeriesWatched(serverDb, parsed.data.seriesTmdbId);
  return json({ ok: true });
};
