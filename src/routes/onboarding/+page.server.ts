import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { IS_LOCAL } from '$lib/config';

export const load: PageServerLoad = async ({ locals }) => {
  if (IS_LOCAL) return {};
  if (locals.onboardingCompleted) throw redirect(302, '/');
  return {};
};
