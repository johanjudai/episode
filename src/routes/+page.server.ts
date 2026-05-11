import type { Actions, PageServerLoad } from './$types';
import {
  getEpisodesToWatch,
  getUpcomingEpisodes,
  markEpisodeWatched,
  unfollowSeries
} from '$lib/server/db/queries';
import { fail } from '@sveltejs/kit';
import { z } from 'zod';

export const load: PageServerLoad = async () => {
  const now = new Date();
  const [toWatch, upcoming] = await Promise.all([
    getEpisodesToWatch(now),
    getUpcomingEpisodes(7, now)
  ]);
  return {
    toWatch,
    upcoming,
    now: now.toISOString()
  };
};

const MarkWatched = z.object({
  episodeId: z.coerce.number().int().positive()
});

const UnfollowSeriesForm = z.object({
  seriesTmdbId: z.coerce.number().int().positive()
});

export const actions: Actions = {
  markWatched: async ({ request }) => {
    const form = await request.formData();
    const parsed = MarkWatched.safeParse(Object.fromEntries(form));
    if (!parsed.success) return fail(400, { error: 'Invalid episode id' });
    await markEpisodeWatched(parsed.data.episodeId);
    return { success: true };
  },
  unfollowSeries: async ({ request }) => {
    const form = await request.formData();
    const parsed = UnfollowSeriesForm.safeParse(Object.fromEntries(form));
    if (!parsed.success) return fail(400, { error: 'Invalid series id' });
    await unfollowSeries(parsed.data.seriesTmdbId);
    return { success: true };
  }
};
