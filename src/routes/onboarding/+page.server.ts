import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { IS_LOCAL } from '$lib/config';

/* Expose whether a TMDB key is already configured so the onboarding
 * import section can decide whether to ask for one. In server target,
 * keys may come from the DB (user-set) or from .env. Local target has
 * no env path — we always need an in-app key. */
export const load: PageServerLoad = async ({ locals }) => {
  if (IS_LOCAL) return { tmdb: { hasKey: false, fromEnv: false } };
  if (locals.onboardingCompleted) throw redirect(302, '/');

  const { serverDb } = await import('$lib/server/db');
  const { getSetting } = await import('$lib/data/queries');
  const apiKey = await getSetting(serverDb, 'tmdb.api_key');
  const envKey = env.EPISODE_TMDB_API_KEY ?? '';
  return {
    tmdb: {
      hasKey: !!apiKey || !!envKey,
      fromEnv: !apiKey && !!envKey
    }
  };
};
