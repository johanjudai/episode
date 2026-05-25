import type { PageServerLoad } from './$types';
import { IS_LOCAL } from '$lib/config';

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
