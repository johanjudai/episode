import type { PageServerLoad } from './$types';
import { IS_LOCAL } from '$lib/config';

export const load: PageServerLoad = async () => {
  if (IS_LOCAL) return { series: [] };
  const { serverDb } = await import('$lib/server/db');
  const { getFollowedSeriesWithProgress } = await import('$lib/data/queries');
  return { series: await getFollowedSeriesWithProgress(serverDb) };
};
