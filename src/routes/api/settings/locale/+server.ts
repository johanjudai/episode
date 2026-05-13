import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { serverDb } from '$lib/server/db';
import { setSetting } from '$lib/data/mutations';
import type { RequestHandler } from './$types';

const Body = z.object({ locale: z.enum(['fr', 'en']) });

export const POST: RequestHandler = async ({ request }) => {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw error(400, 'Locale invalide');
  await setSetting(serverDb, 'locale', parsed.data.locale);
  return json({ ok: true });
};
