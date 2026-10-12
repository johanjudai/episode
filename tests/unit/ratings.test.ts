import { describe, it, expect } from 'vitest';
import { fetchSeriesRatings } from '$lib/data/ratings';
import type { TmdbTvDetail } from '$lib/data/tmdb';

const animeDetail = {
  id: 222623,
  name: 'The Elusive Samurai',
  first_air_date: '2024-07-06',
  vote_average: 8.4,
  vote_count: 120,
  genres: [{ id: 16, name: 'Animation' }],
  original_language: 'ja',
  origin_country: ['JP']
} as TmdbTvDetail;

/* Never settles unless aborted — what an unreachable host looks like to fetch. */
const hangUntilAborted: typeof fetch = (_input, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
  });

describe('fetchSeriesRatings', () => {
  it('gives up on a hanging source instead of stalling the series page', async () => {
    const fetchImpl: typeof fetch = (input, init) => {
      const url = String(input);
      if (url.includes('api.themoviedb.org')) {
        return Promise.resolve(new Response(JSON.stringify({ imdb_id: null })));
      }
      return hangUntilAborted(input, init);
    };

    const ratings = await fetchSeriesRatings({
      tmdbId: 222623,
      tmdbApiKey: 'test-key-123',
      tmdbDetail: animeDetail,
      fetchImpl,
      timeoutMs: 50
    });

    expect(ratings).toEqual({ tmdb: { average: 8.4, count: 120 }, external: [] });
  });
});
