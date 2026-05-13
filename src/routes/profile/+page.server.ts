import type { PageServerLoad } from './$types';
import { IS_LOCAL } from '$lib/config';

export const load: PageServerLoad = async () => {
  if (IS_LOCAL) {
    return {
      profile: { name: '', avatar: null as string | null, createdAt: null as string | null },
      stats: { totalMinutes: 0, seriesCount: 0, episodesWatched: 0 },
      history: [] as Awaited<ReturnType<typeof import('$lib/data/queries').getRecentWatched>>
    };
  }
  const { serverDb } = await import('$lib/server/db');
  const { getRecentWatched, getSetting, getStats } = await import('$lib/data/queries');
  const [name, avatar, createdAt, stats, history] = await Promise.all([
    getSetting(serverDb, 'profile.name'),
    getSetting(serverDb, 'profile.avatar'),
    getSetting(serverDb, 'onboarding.completed_at'),
    getStats(serverDb),
    getRecentWatched(serverDb, 20)
  ]);
  return {
    profile: { name: name ?? '', avatar, createdAt },
    stats,
    history
  };
};
