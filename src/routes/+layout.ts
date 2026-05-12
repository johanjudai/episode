/**
 * Root layout — controls SSR & prerender behavior per target.
 *
 *  - server target: SSR + CSR (default). Onboarding gate is enforced by
 *    `hooks.server.ts`. `+layout.server.ts` provides `onboardingCompleted`.
 *  - local target: no SSR, full SPA. The onboarding gate runs in
 *    `+layout.svelte` via the `redirect` returned here.
 */
import { redirect } from '@sveltejs/kit';
import { browser } from '$app/environment';
import { IS_LOCAL } from '$lib/config';
import type { LayoutLoad } from './$types';

export const ssr = !IS_LOCAL;
/* Local target is a pure SPA: the static adapter ships a single
 * `fallback: 'index.html'` shell and the client-side router handles every
 * route. No page is prerendered. */
export const prerender = false;
export const trailingSlash = 'never';

export const load: LayoutLoad = async ({ data, url }) => {
  /* Server target: the +layout.server.ts has already returned the flag. */
  if (!IS_LOCAL) return { ...data };

  /* Local target: check onboarding state from the local DB on the client. */
  if (!browser) return { onboardingCompleted: true };

  const { getDb } = await import('$lib/db');
  const { getSetting } = await import('$lib/data/queries');
  const db = await getDb();
  const completed = (await getSetting(db, 'onboarding.completed_at')) !== null;

  if (!completed && !url.pathname.startsWith('/onboarding')) {
    throw redirect(302, '/onboarding');
  }
  if (completed && url.pathname.startsWith('/onboarding')) {
    throw redirect(302, '/');
  }
  return { onboardingCompleted: completed };
};
