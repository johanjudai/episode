import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { serverDb } from '$lib/server/db';
import { markEpisodeWatched } from '$lib/data/mutations';
import type { RequestHandler } from './$types';

const Body = z.object({ episodeId: z.number().int().positive() });

export const POST: RequestHandler = async ({ request }) => {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw error(400, 'Invalid episode id');
  await markEpisodeWatched(serverDb, parsed.data.episodeId);
  return json({ ok: true });
};
