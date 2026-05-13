import type { LayoutServerLoad } from './$types';
import { IS_LOCAL } from '$lib/config';

export const load: LayoutServerLoad = async ({ locals }) => {
  if (IS_LOCAL) {
    return { onboardingCompleted: true, locale: 'fr' as const };
  }
  const { serverDb } = await import('$lib/server/db');
  const { getSetting } = await import('$lib/data/queries');
  const stored = await getSetting(serverDb, 'locale');
  const locale = stored === 'en' ? 'en' : 'fr';
  return {
    onboardingCompleted: locals.onboardingCompleted,
    locale
  };
};
