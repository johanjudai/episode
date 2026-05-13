import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { serverDb } from '$lib/server/db';
import { getRecentWatched } from '$lib/data/queries';
import type { RequestHandler } from './$types';

const Query = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(50).default(5)
});

export const GET: RequestHandler = async ({ url }) => {
  const parsed = Query.safeParse({
    offset: url.searchParams.get('offset') ?? 0,
    limit: url.searchParams.get('limit') ?? 5
  });
  if (!parsed.success) return json({ rows: [] }, { status: 400 });
  const rows = await getRecentWatched(serverDb, parsed.data.limit, parsed.data.offset);
  return json({ rows });
};
