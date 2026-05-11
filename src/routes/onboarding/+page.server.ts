import type { Actions, PageServerLoad } from './$types';
import { redirect, fail } from '@sveltejs/kit';
import { setSetting } from '$lib/server/db/queries';
import { z } from 'zod';

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.onboardingCompleted) throw redirect(302, '/');
  return {};
};

const Profile = z.object({
  name: z.string().trim().min(1).max(80),
  avatar: z.string().max(500_000).optional()
});

export const actions: Actions = {
  complete: async ({ request }) => {
    const form = await request.formData();
    const parsed = Profile.safeParse({
      name: form.get('name'),
      avatar: form.get('avatar') ?? undefined
    });
    if (!parsed.success) {
      return fail(400, { error: 'Nom invalide', fieldErrors: parsed.error.flatten().fieldErrors });
    }
    await setSetting('profile.name', parsed.data.name);
    if (parsed.data.avatar) await setSetting('profile.avatar', parsed.data.avatar);
    await setSetting('onboarding.completed_at', new Date().toISOString());
    throw redirect(303, '/');
  }
};
