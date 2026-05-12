import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { serverDb } from '$lib/server/db';
import { setSetting } from '$lib/data/mutations';
import { isAvatarDataUrl, MAX_AVATAR_LENGTH } from '$lib/utils/avatar';
import type { RequestHandler } from './$types';

const Body = z.object({
  name: z.string().trim().min(1).max(80),
  avatar: z
    .string()
    .max(MAX_AVATAR_LENGTH)
    .refine((v) => v === '' || isAvatarDataUrl(v), 'Image invalide')
    .optional()
    .default('')
});

export const POST: RequestHandler = async ({ request }) => {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw error(400, 'Données invalides');
  await setSetting(serverDb, 'profile.name', parsed.data.name);
  if (parsed.data.avatar) await setSetting(serverDb, 'profile.avatar', parsed.data.avatar);
  await setSetting(serverDb, 'onboarding.completed_at', new Date().toISOString());
  return json({ ok: true });
};
