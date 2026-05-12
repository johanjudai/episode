import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { serverDb } from '$lib/server/db';
import { setSetting } from '$lib/data/mutations';
import { createTmdbClient, TmdbError } from '$lib/data/tmdb';
import type { RequestHandler } from './$types';

const Body = z.object({ apiKey: z.string().trim().min(8).max(200) });

export const POST: RequestHandler = async ({ request }) => {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw error(400, 'Clé invalide');
  try {
    const client = createTmdbClient({ apiKey: parsed.data.apiKey });
    await client.trendingTv('week');
  } catch (err) {
    if (err instanceof TmdbError) throw error(400, `TMDB: ${err.message}`);
    throw error(500, 'Validation TMDB échouée');
  }
  await setSetting(serverDb, 'tmdb.api_key', parsed.data.apiKey);
  return json({ ok: true });
};
