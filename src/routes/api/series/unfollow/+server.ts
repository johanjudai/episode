import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { serverDb } from '$lib/server/db';
import { unfollowSeries } from '$lib/data/mutations';
import type { RequestHandler } from './$types';

const Body = z.object({ seriesTmdbId: z.number().int().positive() });

export const POST: RequestHandler = async ({ request }) => {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw error(400, 'Invalid series id');
  await unfollowSeries(serverDb, parsed.data.seriesTmdbId);
  return json({ ok: true });
};
