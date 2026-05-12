import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { serverDb } from '$lib/server/db';
import { setSetting } from '$lib/data/mutations';
import type { RequestHandler } from './$types';

const Body = z.object({ name: z.string().trim().min(1).max(80) });

export const POST: RequestHandler = async ({ request }) => {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw error(400, 'Nom invalide');
  await setSetting(serverDb, 'profile.name', parsed.data.name);
  return json({ ok: true });
};
