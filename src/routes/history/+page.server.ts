import type { PageServerLoad } from './$types';
import { IS_LOCAL } from '$lib/config';

export const load: PageServerLoad = async () => {
  if (IS_LOCAL) {
    return {
      history: [] as Awaited<ReturnType<typeof import('$lib/data/queries').getRecentWatched>>,
      now: new Date().toISOString()
    };
  }
  const { serverDb } = await import('$lib/server/db');
  const { getRecentWatched } = await import('$lib/data/queries');
  return {
    history: await getRecentWatched(serverDb, 500),
    now: new Date().toISOString()
  };
};
