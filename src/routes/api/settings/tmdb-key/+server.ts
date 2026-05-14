import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { env } from '$env/dynamic/private';
import { serverDb } from '$lib/server/db';
import { setSetting } from '$lib/data/mutations';
import { createTmdbClient, TmdbError } from '$lib/data/tmdb';
import type { RequestHandler } from './$types';

const Body = z.object({ apiKey: z.string().trim().min(8).max(200) });

export const POST: RequestHandler = async ({ request }) => {
  /* When the deployment manages the TMDB key through .env, refuse the
   * override: the DB value would win over env in the rest of the code,
   * so a malicious POST could silently swap the configured key. The
   * settings UI already hides the input form in this case; rejecting
   * the API call too closes the gap for direct requests. */
  if (env.EPISODE_TMDB_API_KEY) {
    throw error(409, 'TMDB key is managed via .env on the server — edits disabled.');
  }
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
