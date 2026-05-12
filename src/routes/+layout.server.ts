import type { LayoutServerLoad } from './$types';
import { IS_LOCAL } from '$lib/config';

export const load: LayoutServerLoad = async ({ locals }) => {
  if (IS_LOCAL) return { onboardingCompleted: true };
  return { onboardingCompleted: locals.onboardingCompleted };
};
