import type { PageServerLoad } from './$types';
import { IS_LOCAL } from '$lib/config';

export const load: PageServerLoad = async () => {
  if (IS_LOCAL) {
    return {
      profile: { name: '', avatar: null as string | null },
      tmdb: { hasKey: false }
    };
  }
  const { serverDb } = await import('$lib/server/db');
  const { getSetting } = await import('$lib/data/queries');
  const [name, avatar, apiKey] = await Promise.all([
    getSetting(serverDb, 'profile.name'),
    getSetting(serverDb, 'profile.avatar'),
    getSetting(serverDb, 'tmdb.api_key')
  ]);
  return {
    profile: { name: name ?? '', avatar },
    tmdb: { hasKey: !!apiKey || !!process.env.EPISODE_TMDB_API_KEY }
  };
};
