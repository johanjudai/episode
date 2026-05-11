import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
  return {
    onboardingCompleted: locals.onboardingCompleted
  };
};
