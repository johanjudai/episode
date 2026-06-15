/**
 * Background freshness sweep — throttling, staleness selection, and the
 * "only deep-sync when content grew" trigger. The expensive sync path is
 * covered elsewhere; here we inject a fake TMDB client so the suite stays
 * offline and deterministic, and assert on the cheap-check bookkeeping
 * (cooldown, which series get touched, count growth detection).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resyncStaleFollowedSeries } from '../../src/lib/data/freshness';
import { followSeries, updateSeriesSyncState } from '../../src/lib/data/mutations';
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
      /* Seed more stale series than MAX_PER_SWEEP (8) and confirm the
       * sweep checks at most the cap. */
      for (let i = 1; i <= 12; i++) await makeStaleSeries(i, 1, 5);
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
      expect(r.checked).toBe(8);
      expect(checkedIds).toHaveLength(8);
    });
  });
}
