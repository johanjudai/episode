import type { PageServerLoad } from './$types';
import { getRecentWatched } from '$lib/server/db/queries';

export const load: PageServerLoad = async () => {
  const all = await getRecentWatched(500);
  return {
    history: all,
    now: new Date().toISOString()
  };
};
