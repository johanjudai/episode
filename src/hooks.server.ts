import type { Handle } from '@sveltejs/kit';
import { getSetting } from '$lib/server/db/queries';

export const handle: Handle = async ({ event, resolve }) => {
  const completed = (await getSetting('onboarding.completed_at')) !== null;
  event.locals.onboardingCompleted = completed;

  const url = event.url.pathname;
  const isOnboarding = url.startsWith('/onboarding');
  const isAsset = url.startsWith('/_app') || url === '/favicon.ico';

  if (!completed && !isOnboarding && !isAsset) {
    return new Response(null, { status: 302, headers: { location: '/onboarding' } });
  }

  return resolve(event);
};
