import type { PageLoad } from './$types';
import { browser } from '$app/environment';
import { IS_LOCAL } from '$lib/config';

export const load: PageLoad = async ({ data }) => {
  if (!IS_LOCAL) return { ...data };
  if (!browser) return { ...data };
  const { getDb } = await import('$lib/db');
  const { getSetting } = await import('$lib/data/queries');
  const db = await getDb();
  const [name, avatar, apiKey] = await Promise.all([
    getSetting(db, 'profile.name'),
    getSetting(db, 'profile.avatar'),
    getSetting(db, 'tmdb.api_key')
  ]);
  return {
    profile: { name: name ?? '', avatar },
    tmdb: { hasKey: !!apiKey }
  };
};
