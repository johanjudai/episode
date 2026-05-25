import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { serverDb } from '$lib/server/db';
import { requireTmdbKey } from '$lib/server/api-helpers';
import { ensureEpisodeRow, syncSeriesFull } from '$lib/data/sync';
import { getSeries } from '$lib/data/queries';
import { markEpisodeWatched, markEpisodesUpTo, unmarkEpisodeWatched } from '$lib/data/mutations';
import type { RequestHandler } from './$types';

const Body = z.object({
  seriesTmdbId: z.number().int().positive(),
  seasonNumber: z.number().int().nonnegative(),
  episodeNumber: z.number().int().nonnegative(),
  watched: z.boolean(),
  markPrevious: z.boolean().optional()
});

export const POST: RequestHandler = async ({ request }) => {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw error(400, 'Invalid payload');
  const apiKey = await requireTmdbKey(serverDb);

  const existing = await getSeries(serverDb, parsed.data.seriesTmdbId);
  if (!existing || existing.removedAt) {
    await syncSeriesFull(serverDb, apiKey, parsed.data.seriesTmdbId, { follow: true });
  }
  const epId = await ensureEpisodeRow(
    serverDb,
    apiKey,
    parsed.data.seriesTmdbId,
    parsed.data.seasonNumber,
    parsed.data.episodeNumber
  );

  if (parsed.data.watched) {
    if (parsed.data.markPrevious) {
      await markEpisodesUpTo(
        serverDb,
        parsed.data.seriesTmdbId,
        parsed.data.seasonNumber,
        parsed.data.episodeNumber
      );
    } else {
      await markEpisodeWatched(serverDb, epId);
    }
  } else {
    await unmarkEpisodeWatched(serverDb, epId);
  }
  return json({ ok: true });
};
