import { json } from '@sveltejs/kit';
import { serverDb } from '$lib/server/db';
import { getTmdbKey } from '$lib/server/api-helpers';
import { getSetting } from '$lib/data/queries';
import { resyncStaleFollowedSeries } from '$lib/data/freshness';
import { tmdbLanguageFromStored } from '$lib/i18n';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async () => {
  const apiKey = await getTmdbKey(serverDb);
  if (!apiKey) return json({ changed: false });
  const language = tmdbLanguageFromStored(await getSetting(serverDb, 'locale'));
  const r = await resyncStaleFollowedSeries(serverDb, apiKey, { language });
  return json({ changed: r.updated > 0 || r.releaseTimesFixed > 0 });
};
