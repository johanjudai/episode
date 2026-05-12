import type { Handle } from '@sveltejs/kit';
import { IS_LOCAL } from '$lib/config';
import { getSetting } from '$lib/data/queries';

export const handle: Handle = async ({ event, resolve }) => {
  /* In local-target builds there is no server-side DB and the route guard
   * runs in the browser via +layout.ts. The Vite plugin replaces this file
   * with a no-op for local builds anyway, but the early return is a belt-
   * and-braces fallback for prerender / SSR-disabled paths. */
  if (IS_LOCAL) return resolve(event);

  const { serverDb } = await import('$lib/server/db');
  const completed = (await getSetting(serverDb, 'onboarding.completed_at')) !== null;
  event.locals.onboardingCompleted = completed;

  const url = event.url.pathname;
  const isOnboarding = url.startsWith('/onboarding');
  const isAsset = url.startsWith('/_app') || url === '/favicon.ico';
  const isApi = url.startsWith('/api/');

  if (!completed && !isOnboarding && !isAsset && !isApi) {
    return new Response(null, { status: 302, headers: { location: '/onboarding' } });
  }

  return resolve(event);
};
