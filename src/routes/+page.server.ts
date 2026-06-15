import type { PageServerLoad } from './$types';
import { IS_LOCAL } from '$lib/config';
import { tmdbLanguageFromStored } from '$lib/i18n';

export const load: PageServerLoad = async () => {
  if (IS_LOCAL) {
    /* Local target: SSR is disabled by the root layout. Return a placeholder
     * so the universal +page.ts gets a typed shape to merge over. */
    return { toWatch: [], upcoming: [], recent: [], now: new Date().toISOString() };
  }
  const { serverDb } = await import('$lib/server/db');
  const { getEpisodesToWatch, getRecentWatched, getUpcomingEpisodes } =
    await import('$lib/data/queries');
  const now = new Date();

  /* Fire-and-forget background freshness sweep: pulls newly-released
   * seasons of followed series into the local DB so they resurface here on
   * a later visit. Self-throttling (see resyncStaleFollowedSeries) and
   * never awaited, so it can't slow down the home render. The persistent
   * Node server keeps the promise alive after the response is sent. */
  void (async () => {
    const { getTmdbKey } = await import('$lib/server/api-helpers');
    const apiKey = await getTmdbKey(serverDb);
    if (!apiKey) return;
    const { getSetting } = await import('$lib/data/queries');
    const language = tmdbLanguageFromStored(await getSetting(serverDb, 'locale'));
    const { resyncStaleFollowedSeries } = await import('$lib/data/freshness');
    await resyncStaleFollowedSeries(serverDb, apiKey, { language });
  })().catch(() => {});
  /* Fetch a wide 90-day window: the UI defaults to showing the next
   * 7 days but lets the user expand to the full window with a single
   * click. Payload stays small (a handful of episodes per series even
   * for power users) so doing the slice client-side is cheaper than
   * a round trip on toggle.
   * getEpisodesToWatch now returns ONE row per series (the earliest
   * unwatched aired episode), so no JS-side dedupe is needed. */
  const [toWatch, upcoming, recent] = await Promise.all([
    getEpisodesToWatch(serverDb, now),
    getUpcomingEpisodes(serverDb, 90, now),
    getRecentWatched(serverDb, 5)
  ]);
  return {
    toWatch,
    upcoming,
    recent,
    now: now.toISOString()
  };
};
