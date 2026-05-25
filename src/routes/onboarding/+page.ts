import type { PageLoad } from './$types';

/* Universal load: in server-target builds, `data` comes from
 * +page.server.ts (which knows about EPISODE_TMDB_API_KEY). In the
 * local target there's no server load, so we default to "no key yet"
 * — first-launch users on Capacitor land here without anything
 * configured. The onboarding UI then shows a TMDB key field. */
export const load: PageLoad = ({ data }) => {
  return {
    tmdb: data?.tmdb ?? { hasKey: false, fromEnv: false }
  };
};
