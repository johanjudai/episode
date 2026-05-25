import { json } from '@sveltejs/kit';
import { serverDb } from '$lib/server/db';
import { requireTmdbKey } from '$lib/server/api-helpers';
import { getFollowedSeries, getSetting } from '$lib/data/queries';
import { setSetting } from '$lib/data/mutations';
import { syncSeriesFull } from '$lib/data/sync';
import { tmdbLanguageFromStored } from '$lib/i18n';
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
 *
 * Cooldown: this endpoint kicks off N × M TMDB calls per invocation
 * (N series × M seasons). Without a cooldown a malicious POST can
 * burn the user's TMDB quota in seconds — Episode's rate-limit is
 * 60 req burst / 1 rps but each accepted POST then fans out to
 * hundreds of upstream calls. We refuse follow-up calls less than
 * COOLDOWN_MS apart, keyed on a settings row so the limit survives
 * restarts. */
const COOLDOWN_KEY = 'resync_all.last_at';
const COOLDOWN_MS = 60 * 60 * 1000;

export const POST: RequestHandler = async () => {
  const apiKey = await requireTmdbKey(serverDb);

  const lastAtRaw = await getSetting(serverDb, COOLDOWN_KEY);
  const lastAt = lastAtRaw ? Number(lastAtRaw) : 0;
  const now = Date.now();
  if (Number.isFinite(lastAt) && now - lastAt < COOLDOWN_MS) {
    const retryAfter = Math.ceil((COOLDOWN_MS - (now - lastAt)) / 1000);
    return new Response('Resync cooldown active', {
      status: 429,
      headers: { 'retry-after': String(retryAfter), 'content-type': 'text/plain' }
    });
  }
  await setSetting(serverDb, COOLDOWN_KEY, String(now));

  const language = tmdbLanguageFromStored(await getSetting(serverDb, 'locale'));
  const followed = await getFollowedSeries(serverDb);
  for (const s of followed) {
    await syncSeriesFull(serverDb, apiKey, s.tmdbId, { language, refresh: true }).catch((err) => {
      console.warn(`[resync-all] failed for series ${s.tmdbId} (${s.name}):`, err);
    });
  }
  return json({ ok: true, count: followed.length });
};
