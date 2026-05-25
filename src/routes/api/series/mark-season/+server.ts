import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { serverDb } from '$lib/server/db';
import { requireTmdbKey } from '$lib/server/api-helpers';
import { getSeries } from '$lib/data/queries';
import { syncSeason, syncSeriesFull } from '$lib/data/sync';
import { markSeasonsUpTo, markSeasonWatched, unmarkSeasonWatched } from '$lib/data/mutations';
import type { RequestHandler } from './$types';

const Body = z.object({
  seriesTmdbId: z.number().int().positive(),
  seasonNumber: z.number().int().positive(),
  watched: z.boolean(),
  markPrevious: z.boolean().optional()
});

export const POST: RequestHandler = async ({ request }) => {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw error(400, 'Invalid payload');

  if (!parsed.data.watched) {
    await unmarkSeasonWatched(serverDb, parsed.data.seriesTmdbId, parsed.data.seasonNumber);
    return json({ ok: true });
  }

  /* Watched path — TMDB key is mandatory because we may need to
   * sync seasons not yet cached locally. */
  const apiKey = await requireTmdbKey(serverDb);

  const existing = await getSeries(serverDb, parsed.data.seriesTmdbId);
  if (!existing || existing.removedAt) {
    await syncSeriesFull(serverDb, apiKey, parsed.data.seriesTmdbId, { follow: true });
  }
  await syncSeason(serverDb, apiKey, parsed.data.seriesTmdbId, parsed.data.seasonNumber).catch(
    (err) => {
      /* Swallow but log: syncSeriesFull above already synced every
       * season; this is a belt-and-braces refresh of the targeted
       * season. If it fails we still attempt to mark — markSeasonsUpTo
       * just won't find episode rows and writes a 0-row mark, which is
       * the same effective state as before the call. */
      console.warn(
        `[mark-season] supplementary syncSeason failed for tmdb ${parsed.data.seriesTmdbId} S${parsed.data.seasonNumber}:`,
        err
      );
    }
  );

  if (parsed.data.markPrevious) {
    await markSeasonsUpTo(serverDb, parsed.data.seriesTmdbId, parsed.data.seasonNumber);
  } else {
    await markSeasonWatched(serverDb, parsed.data.seriesTmdbId, parsed.data.seasonNumber);
  }
  return json({ ok: true });
};
