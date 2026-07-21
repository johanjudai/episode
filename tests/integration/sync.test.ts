/**
 * Sync-layer integration suite. Runs against BOTH drivers (better-sqlite3
 * + sql.js) like the rest of the integration tests.
 *
 * Focus: the `seasonExists` short-circuit in `syncSeason`. A finished season
 * should skip the TMDB round-trip, but a season still airing (weekly anime,
 * a running show's current season) can gain an episode AFTER it was first
 * synced — and that episode must still reach the local DB. Regression guard
 * for the "anime missing from the feed / can't be checked off" bug.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ensureEpisodeRow, syncSeason } from '../../src/lib/data/sync';
import { followSeries, getEpisodeIdByCoords } from '../../src/lib/data/mutations';
import { getSeasonsWithEpisodes } from '../../src/lib/data/queries';
import { DUAL_DRIVERS, type DriverContext } from './_drivers';

const KEY = 'x'.repeat(16);
const SERIES_ID = 4242;

/** Build a /tv/{id}/season/1 payload with episodes 1..count. */
function seasonPayload(count: number) {
  return {
    id: 1,
    season_number: 1,
    name: 'Saison 1',
    air_date: '2026-01-01',
    poster_path: null,
    episodes: Array.from({ length: count }, (_, i) => ({
      id: 1000 + i + 1,
      episode_number: i + 1,
      season_number: 1,
      name: `Épisode ${i + 1}`,
      overview: `synopsis ${i + 1}`,
      air_date: '2026-01-01',
      runtime: 24,
      still_path: null
    }))
  };
}

/** Stub globalThis.fetch to serve one season payload for the duration of fn. */
async function withSeason<T>(count: number, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input);
    if (url.includes(`/tv/${SERIES_ID}/season/1`)) {
      return new Response(JSON.stringify(seasonPayload(count)), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

for (const driver of DUAL_DRIVERS) {
  describe(`sync — ongoing season growth (${driver.name})`, () => {
    let ctx: DriverContext;

    beforeEach(async () => {
      ctx = await driver.setup();
      /* Series row must exist so syncSeason can resolve its origin timezone. */
      await followSeries(ctx.db, { tmdbId: SERIES_ID, name: 'Weekly Anime' });
      /* First sync: season doesn't exist yet, so 10 episodes are pulled in. */
      await withSeason(10, () => syncSeason(ctx.db, KEY, SERIES_ID, 1));
    });

    afterAll(async () => {
      if (ctx) await ctx.cleanup();
    });

    it('short-circuits an already-synced season (no fill) — misses the new episode', async () => {
      /* TMDB now has 11 episodes, but a plain syncSeason bails on
       * seasonExists and never fetches, so episode 11 stays absent. */
      await withSeason(11, () => syncSeason(ctx.db, KEY, SERIES_ID, 1));
      const id = await getEpisodeIdByCoords(ctx.db, SERIES_ID, 1, 11);
      expect(id).toBeNull();
    });

    it('fillMissing pulls a newly-aired episode into an existing season', async () => {
      await withSeason(11, () => syncSeason(ctx.db, KEY, SERIES_ID, 1, { fillMissing: true }));
      const id = await getEpisodeIdByCoords(ctx.db, SERIES_ID, 1, 11);
      expect(id).not.toBeNull();
    });

    it('fillMissing preserves existing episode rows (insert-only)', async () => {
      /* Serve altered names for the existing episodes alongside the new one;
       * fillMissing must NOT overwrite what's already stored. */
      const original = globalThis.fetch;
      globalThis.fetch = (async () => {
        const p = seasonPayload(11);
        for (const ep of p.episodes) ep.name = `CLOBBERED ${ep.episode_number}`;
        return new Response(JSON.stringify(p), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }) as typeof fetch;
      try {
        await syncSeason(ctx.db, KEY, SERIES_ID, 1, { fillMissing: true });
      } finally {
        globalThis.fetch = original;
      }
      const seasons = await getSeasonsWithEpisodes(ctx.db, SERIES_ID);
      const eps = seasons?.[0].episodes ?? [];
      expect(eps).toHaveLength(11);
      expect(eps.find((e) => e.episodeNumber === 1)?.name).toBe('Épisode 1');
      expect(eps.find((e) => e.episodeNumber === 11)?.name).toBe('CLOBBERED 11');
    });

    it('ensureEpisodeRow recovers a mid-season episode instead of throwing', async () => {
      /* This is the exact mark-episode path: the season row already exists, so
       * the first internal syncSeason short-circuits and getEpisodeIdByCoords
       * returns null — previously a hard "Épisode introuvable" throw. The
       * fillMissing retry now pulls it in and returns the id. */
      const id = await withSeason(11, () => ensureEpisodeRow(ctx.db, KEY, SERIES_ID, 1, 11));
      expect(id).toBeGreaterThan(0);
    });
  });
}
