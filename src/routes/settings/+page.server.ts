import type { PageServerLoad } from './$types';
import { env } from '$env/dynamic/private';
import { IS_LOCAL } from '$lib/config';

export const load: PageServerLoad = async () => {
  if (IS_LOCAL) {
    return {
      profile: { name: '', avatar: null as string | null },
      tmdb: { hasKey: false, fromEnv: false },
      omdb: { hasKey: false, fromEnv: false }
    };
  }
  const { serverDb } = await import('$lib/server/db');
  const { getSetting } = await import('$lib/data/queries');
  const [name, avatar, apiKey, omdbKey] = await Promise.all([
    getSetting(serverDb, 'profile.name'),
    getSetting(serverDb, 'profile.avatar'),
    getSetting(serverDb, 'tmdb.api_key'),
    getSetting(serverDb, 'omdb.api_key')
  ]);
  /* `fromEnv` is true when the only source for the key is the .env on
   * the server — there's no user-supplied DB value to override it. The
   * settings UI hides the input block in that case: the user can't
   * type a key on top of one that's already managed at deployment
   * level. They'd edit .env on the host instead. */
  const tmdbEnvKey = env.EPISODE_TMDB_API_KEY ?? '';
  const omdbEnvKey = env.EPISODE_OMDB_API_KEY ?? '';
  return {
    profile: { name: name ?? '', avatar },
    tmdb: {
      hasKey: !!apiKey || !!tmdbEnvKey,
      fromEnv: !apiKey && !!tmdbEnvKey
    },
    omdb: {
      hasKey: !!omdbKey || !!omdbEnvKey,
      fromEnv: !omdbKey && !!omdbEnvKey
    }
  };
};
