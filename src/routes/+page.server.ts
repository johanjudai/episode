import type { PageServerLoad } from './$types';
import { IS_LOCAL } from '$lib/config';
import { pickNextPerSeries } from '$lib/utils/episodes';

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
  const [allUnwatched, upcoming, recent] = await Promise.all([
    getEpisodesToWatch(serverDb, now),
    getUpcomingEpisodes(serverDb, 7, now),
    getRecentWatched(serverDb, 5)
  ]);
  return {
    toWatch: pickNextPerSeries(allUnwatched),
    upcoming,
    recent,
    now: now.toISOString()
  };
};
