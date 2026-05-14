import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { serverDb } from '$lib/server/db';
import { getFollowedSeries, getSetting } from '$lib/data/queries';
import { syncSeriesFull } from '$lib/data/sync';
import type { RequestHandler } from './$types';

/**
 * Re-fetch every followed series from TMDB and overwrite the cached
 * names / overviews / season titles with the values matching the
 * currently-stored locale. Triggered by the settings page after a
 * locale change.
 *
 * Sequential across series so a 30-series library doesn't burst TMDB
 * (rate limit ≈ 40 req/s globally; per series we still parallelize
 * seasons via syncSeriesFull). Failures per series are silenced — the
 * next mark/visit on that series will retry.
 */
export const POST: RequestHandler = async () => {
  const apiKey = (await getSetting(serverDb, 'tmdb.api_key')) ?? env.EPISODE_TMDB_API_KEY ?? '';
  if (!apiKey) throw error(412, 'Clé TMDB manquante');
  const storedLocale = await getSetting(serverDb, 'locale');
  const language = storedLocale === 'en' ? 'en-US' : 'fr-FR';
  const followed = await getFollowedSeries(serverDb);
  for (const s of followed) {
    await syncSeriesFull(serverDb, apiKey, s.tmdbId, { language, refresh: true }).catch(
      () => undefined
    );
  }
  return json({ ok: true, count: followed.length });
};
