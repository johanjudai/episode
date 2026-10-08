/**
 * Background freshness sweep — throttling, staleness selection, and the
 * deep-sync triggers (counts grew, or last/next episode drifted). The expensive sync path is
 * covered elsewhere; here we inject a fake TMDB client so the suite stays
 * offline and deterministic, and assert on the cheap-check bookkeeping
 * (cooldown, which series get touched, count growth detection).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resyncStaleFollowedSeries } from '../../src/lib/data/freshness';
import {
  followSeries,
  updateSeriesSyncState,
  upsertEpisode,
  upsertSeason
} from '../../src/lib/data/mutations';
import { getSeries } from '../../src/lib/data/queries';
import { DUAL_DRIVERS, type DriverContext } from './_drivers';

for (const driver of DUAL_DRIVERS) {
  describe(`freshness sweep (${driver.name})`, () => {
    let ctx: DriverContext;

    beforeEach(async () => {
      ctx = await driver.setup();
    });

    afterAll(async () => {
      if (ctx) await ctx.cleanup();
    });

    const now = new Date('2026-06-15T12:00:00Z');
    const ancient = new Date('2026-01-01T00:00:00Z'); // well past STALE_MS

    /** A fake client whose tvDetail returns canned counts per tmdbId. */
    function fakeClient(byId: Record<number, { seasons: number; episodes: number }>) {
      return {
        tvDetail: async (id: number) => ({
          id,
          name: `S${id}`,
          number_of_seasons: byId[id]?.seasons ?? 0,
          number_of_episodes: byId[id]?.episodes ?? 0,
          status: 'Returning Series',
          last_air_date: '2026-06-10'
        })
      };
    }

    async function makeStaleSeries(tmdbId: number, seasons: number, episodes: number) {
      await followSeries(ctx.db, {
        tmdbId,
        name: `S${tmdbId}`,
        numberOfSeasons: seasons,
        numberOfEpisodes: episodes
      });
      /* followSeries stamps lastSyncedAt = real now; force it old so the
       * sweep considers it stale. */
      await updateSeriesSyncState(ctx.db, tmdbId, ancient, {
        numberOfSeasons: seasons,
        numberOfEpisodes: episodes
      });
    }

    it('skips the sweep while the cooldown is active', async () => {
      await makeStaleSeries(1, 1, 10);
      /* First run claims the cooldown. */
      const r1 = await resyncStaleFollowedSeries(ctx.db, 'x'.repeat(16), {
        now,
        client: fakeClient({ 1: { seasons: 1, episodes: 10 } })
      });
      expect(r1.ran).toBe(true);
      /* Second run, same instant → cooldown blocks it. */
      const r2 = await resyncStaleFollowedSeries(ctx.db, 'x'.repeat(16), {
        now,
        client: fakeClient({ 1: { seasons: 1, episodes: 10 } })
      });
      expect(r2.ran).toBe(false);
    });

    it('touches a checked-but-unchanged series so it leaves the stale set', async () => {
      await makeStaleSeries(1, 1, 10);
      const r = await resyncStaleFollowedSeries(ctx.db, 'x'.repeat(16), {
        now,
        client: fakeClient({ 1: { seasons: 1, episodes: 10 } })
      });
      expect(r).toMatchObject({ ran: true, checked: 1, updated: 0 });
      const s = await getSeries(ctx.db, 1);
      expect(s?.lastSyncedAt?.getTime()).toBe(now.getTime());
    });

    it('does not check freshly-synced series', async () => {
      /* Synced "now" → not stale → ignored. */
      await followSeries(ctx.db, { tmdbId: 1, name: 'Fresh', numberOfEpisodes: 10 });
      await updateSeriesSyncState(ctx.db, 1, now, { numberOfEpisodes: 10 });
      const r = await resyncStaleFollowedSeries(ctx.db, 'x'.repeat(16), {
        now,
        client: fakeClient({ 1: { seasons: 1, episodes: 99 } })
      });
      expect(r).toMatchObject({ ran: true, checked: 0, updated: 0 });
    });

    it('deep-syncs and refreshes counts when content grew', async () => {
      await makeStaleSeries(1, 1, 10);
      const deepSynced: number[] = [];
      /* Episode count grew 10 → 12, season 1 → 2. */
      const r = await resyncStaleFollowedSeries(ctx.db, 'x'.repeat(16), {
        now,
        client: fakeClient({ 1: { seasons: 2, episodes: 12 } }),
        deepSync: async (id) => {
          deepSynced.push(id);
        }
      });
      expect(r).toMatchObject({ ran: true, checked: 1, updated: 1 });
      expect(deepSynced).toEqual([1]);
      const s = await getSeries(ctx.db, 1);
      expect(s?.numberOfSeasons).toBe(2);
      expect(s?.numberOfEpisodes).toBe(12);
      expect(s?.lastSyncedAt?.getTime()).toBe(now.getTime());
    });

    it('respects the per-sweep cap (does not check the whole library at once)', async () => {
      /* Seed more stale series than MAX_PER_SWEEP (20) and confirm the
       * sweep checks at most the cap. */
      for (let i = 1; i <= 25; i++) await makeStaleSeries(i, 1, 5);
      const checkedIds: number[] = [];
      const r = await resyncStaleFollowedSeries(ctx.db, 'x'.repeat(16), {
        now,
        client: {
          tvDetail: async (id: number) => {
            checkedIds.push(id);
            return { id, name: `S${id}`, number_of_seasons: 1, number_of_episodes: 5 };
          }
        }
      });
      expect(r.checked).toBe(20);
      expect(checkedIds).toHaveLength(20);
    });

    async function seedEpisode(tmdbId: number, episodeNumber: number, airDate: string | null) {
      const seasonId = await upsertSeason(ctx.db, { seriesTmdbId: tmdbId, seasonNumber: 1 });
      await upsertEpisode(ctx.db, {
        seasonId,
        seriesTmdbId: tmdbId,
        seasonNumber: 1,
        episodeNumber,
        airDate
      });
    }

    function clientWithLastEpisode(airDate: string) {
      return {
        tvDetail: async (id: number) => ({
          id,
          name: `S${id}`,
          number_of_seasons: 1,
          number_of_episodes: 10,
          status: 'Returning Series',
          last_episode_to_air: { season_number: 1, episode_number: 5, air_date: airDate },
          next_episode_to_air: null
        })
      };
    }

    it('re-syncs the season when the aired episode is dated differently locally', async () => {
      /* Episode listed early with no date: counts never grow, but it aired. */
      await makeStaleSeries(1, 1, 10);
      await seedEpisode(1, 5, null);
      const calls: Array<[number, number[] | undefined]> = [];
      const r = await resyncStaleFollowedSeries(ctx.db, 'x'.repeat(16), {
        now,
        client: clientWithLastEpisode('2026-06-14'),
        deepSync: async (id, seasons) => {
          calls.push([id, seasons]);
        }
      });
      expect(r).toMatchObject({ ran: true, checked: 1, updated: 1 });
      expect(calls).toEqual([[1, [1]]]);
    });

    it('re-syncs the season when the aired episode is missing locally', async () => {
      await makeStaleSeries(1, 1, 10);
      await seedEpisode(1, 4, '2026-06-07');
      const calls: Array<[number, number[] | undefined]> = [];
      await resyncStaleFollowedSeries(ctx.db, 'x'.repeat(16), {
        now,
        client: clientWithLastEpisode('2026-06-14'),
        deepSync: async (id, seasons) => {
          calls.push([id, seasons]);
        }
      });
      expect(calls).toEqual([[1, [1]]]);
    });

    it('leaves an up-to-date season alone', async () => {
      await makeStaleSeries(1, 1, 10);
      await seedEpisode(1, 5, '2026-06-14');
      const calls: number[] = [];
      const r = await resyncStaleFollowedSeries(ctx.db, 'x'.repeat(16), {
        now,
        client: clientWithLastEpisode('2026-06-14'),
        deepSync: async (id) => {
          calls.push(id);
        }
      });
      expect(r.updated).toBe(0);
      expect(calls).toEqual([]);
    });

    it('re-derives stored release instants with the current timing rules', async () => {
      /* Stored under the old rule (20:00 New York) for a streamer. */
      await followSeries(ctx.db, {
        tmdbId: 1,
        name: 'Streamer',
        network: 'Netflix',
        originCountry: 'US'
      });
      const seasonId = await upsertSeason(ctx.db, { seriesTmdbId: 1, seasonNumber: 1 });
      await upsertEpisode(ctx.db, {
        seasonId,
        seriesTmdbId: 1,
        seasonNumber: 1,
        episodeNumber: 1,
        airDate: '2026-06-20',
        releaseAt: Date.UTC(2026, 5, 21, 0, 0, 0)
      });
      const r = await resyncStaleFollowedSeries(ctx.db, 'x'.repeat(16), {
        now,
        client: fakeClient({})
      });
      expect(r.releaseTimesFixed).toBe(1);
      const row = ctx.raw.prepareGet<{ release_at: number }>(
        'SELECT release_at FROM episodes WHERE series_tmdb_id = 1'
      );
      /* 2026-06-20 00:00 PDT. */
      expect(row?.release_at).toBe(Date.UTC(2026, 5, 20, 7, 0, 0));
    });

    it('re-checks running series sooner than ended ones, running first', async () => {
      /* Both synced a day ago: past the running threshold, not the ended one. */
      const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      await followSeries(ctx.db, { tmdbId: 1, name: 'Running', status: 'Returning Series' });
      await updateSeriesSyncState(ctx.db, 1, dayAgo);
      await followSeries(ctx.db, { tmdbId: 2, name: 'Ended', status: 'Ended' });
      await updateSeriesSyncState(ctx.db, 2, dayAgo);
      /* Ended long ago: due, but checked after the running one. */
      await followSeries(ctx.db, { tmdbId: 3, name: 'Old ended', status: 'Ended' });
      await updateSeriesSyncState(ctx.db, 3, ancient);
      const checkedIds: number[] = [];
      await resyncStaleFollowedSeries(ctx.db, 'x'.repeat(16), {
        now,
        client: {
          tvDetail: async (id: number) => {
            checkedIds.push(id);
            return { id, name: `S${id}`, number_of_seasons: 0, number_of_episodes: 0 };
          }
        }
      });
      expect(checkedIds).toEqual([1, 3]);
    });
  });
}
