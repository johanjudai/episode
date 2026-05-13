import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { serverDb } from '$lib/server/db';
import { setSetting } from '$lib/data/mutations';
import { createOmdbClient, OmdbError } from '$lib/data/omdb';
import type { RequestHandler } from './$types';

const Body = z.object({ apiKey: z.string().trim().min(4).max(64) });

export const POST: RequestHandler = async ({ request }) => {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw error(400, 'Clé OMDb invalide');
  try {
    /* Validate by looking up a well-known IMDb id (The Boys). */
    const client = createOmdbClient({ apiKey: parsed.data.apiKey });
    const resp = await client.byImdbId('tt1190634');
    if (resp.Response !== 'True') {
      throw error(
        400,
        `OMDb: ${resp.Response === 'False' ? (resp.Error ?? 'rejected') : 'unexpected response'}`
      );
    }
  } catch (err) {
    if (err instanceof OmdbError) throw error(400, `OMDb: ${err.message}`);
    throw err;
  }
  await setSetting(serverDb, 'omdb.api_key', parsed.data.apiKey);
  return json({ ok: true });
};
