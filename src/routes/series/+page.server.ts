import type { PageServerLoad } from './$types';
import { getFollowedSeriesWithProgress } from '$lib/server/db/queries';

export const load: PageServerLoad = async () => {
  return {
    series: await getFollowedSeriesWithProgress()
  };
};
