import type { PageLoad } from './$types';
import { browser } from '$app/environment';
import { IS_LOCAL } from '$lib/config';

export const load: PageLoad = async ({ data }) => {
  /* Server target: trust the server load output untouched. */
  if (!IS_LOCAL) {
    return { ...data };
  }
  /* Local target: load from the browser DB. SSR is disabled at the root
   * layout, so this only runs in the browser. */
  if (!browser) {
    return { toWatch: [], upcoming: [], recent: [], now: new Date().toISOString() };
  }
  const { getDb } = await import('$lib/db');
  const { getEpisodesToWatch, getRecentWatched, getUpcomingEpisodes, getSetting } =
    await import('$lib/data/queries');
  const db = await getDb();
  const now = new Date();

  /* Fire-and-forget background freshness sweep — see +page.server.ts. Here
   * it runs in the browser/WebView (where TMDB is already called directly),
   * self-throttles, and is never awaited so the home render isn't delayed. */
  void (async () => {
    const apiKey = await getSetting(db, 'tmdb.api_key');
    if (!apiKey) return;
    const { tmdbLanguageFromStored } = await import('$lib/i18n');
    const language = tmdbLanguageFromStored(await getSetting(db, 'locale'));
    const { resyncStaleFollowedSeries } = await import('$lib/data/freshness');
    await resyncStaleFollowedSeries(db, apiKey, { language });
  })().catch(() => {});
  /* Same 90-day window as the server target — see +page.server.ts. */
  const [toWatch, upcoming, recent] = await Promise.all([
    getEpisodesToWatch(db, now),
    getUpcomingEpisodes(db, 90, now),
    getRecentWatched(db, 5)
  ]);
  return {
    toWatch,
    upcoming,
    recent,
    now: now.toISOString()
  };
};
