import type { PageLoad } from './$types';
import { browser } from '$app/environment';
import { IS_LOCAL } from '$lib/config';

export const load: PageLoad = async ({ data }) => {
  if (!IS_LOCAL) return { ...data };
  if (!browser) return { ...data };
  const { getDb } = await import('$lib/db');
  const { getRecentWatched } = await import('$lib/data/queries');
  const db = await getDb();
  return { history: await getRecentWatched(db, 500), now: new Date().toISOString() };
};
