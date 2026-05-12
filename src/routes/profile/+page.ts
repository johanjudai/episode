import type { PageLoad } from './$types';
import { browser } from '$app/environment';
import { IS_LOCAL } from '$lib/config';

export const load: PageLoad = async ({ data }) => {
  if (!IS_LOCAL) return { ...data };
  if (!browser) return { ...data };
  const { getDb } = await import('$lib/db');
  const { getRecentWatched, getSetting, getStats } = await import('$lib/data/queries');
  const db = await getDb();
  const [name, avatar, createdAt, stats, history] = await Promise.all([
    getSetting(db, 'profile.name'),
    getSetting(db, 'profile.avatar'),
    getSetting(db, 'onboarding.completed_at'),
    getStats(db),
    getRecentWatched(db, 20)
  ]);
  return {
    profile: { name: name ?? 'Vous', avatar, createdAt },
    stats,
    history
  };
};
