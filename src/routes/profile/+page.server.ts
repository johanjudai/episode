import type { PageServerLoad } from './$types';
import { getRecentWatched, getSetting, getStats } from '$lib/server/db/queries';

export const load: PageServerLoad = async () => {
  const [name, avatar, createdAt, stats, history] = await Promise.all([
    getSetting('profile.name'),
    getSetting('profile.avatar'),
    getSetting('onboarding.completed_at'),
    getStats(),
    getRecentWatched(20)
  ]);
  return {
    profile: { name: name ?? 'Vous', avatar, createdAt },
    stats,
    history
  };
};
