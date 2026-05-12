import type { PageLoad } from './$types';
import { browser } from '$app/environment';
import { IS_LOCAL } from '$lib/config';

export const load: PageLoad = async ({ data }) => {
  if (!IS_LOCAL) return { ...data };
  if (!browser) return { series: [] };
  const { getDb } = await import('$lib/db');
  const { getFollowedSeriesWithProgress } = await import('$lib/data/queries');
  const db = await getDb();
  return { series: await getFollowedSeriesWithProgress(db) };
};
