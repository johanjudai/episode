import { describe, it, expect, vi } from 'vitest';
import { createTmdbClient, TmdbError, pickBestTrailer } from '$lib/data/tmdb';
import type { TmdbVideo } from '$lib/data/tmdb';

function mockOk(body: unknown): typeof fetch {
  return vi.fn(
    async () => new Response(JSON.stringify(body), { status: 200 })
  ) as unknown as typeof fetch;
}

function mockFail(status: number, statusText = 'Error'): typeof fetch {
  return vi.fn(async () => new Response('', { status, statusText })) as unknown as typeof fetch;
}

describe('createTmdbClient', () => {
  it('throws if api key missing', () => {
    expect(() => createTmdbClient({ apiKey: '' })).toThrow(TmdbError);
    expect(() => createTmdbClient({ apiKey: 'tiny' })).toThrow(TmdbError);
  });

  it('constructs search URL with query, language and api_key', async () => {
    const f = vi.fn(async (url: string) => {
      const u = new URL(url);
      expect(u.pathname).toBe('/3/search/tv');
      expect(u.searchParams.get('api_key')).toBe('TESTKEY123');
      expect(u.searchParams.get('language')).toBe('fr-FR');
      expect(u.searchParams.get('query')).toBe('severance');
      expect(u.searchParams.get('include_adult')).toBe('false');
      return new Response(
        JSON.stringify({ page: 1, results: [], total_pages: 0, total_results: 0 }),
        { status: 200 }
      );
    });
    const client = createTmdbClient({ apiKey: 'TESTKEY123', fetch: f as unknown as typeof fetch });
    await client.searchTv('severance');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('parses search results', async () => {
    const body = {
      page: 1,
      total_pages: 1,
      total_results: 1,
      results: [
        {
          id: 95396,
          name: 'Severance',
          first_air_date: '2022-02-17',
          poster_path: '/abc.jpg'
        }
      ]
    };
    const client = createTmdbClient({
      apiKey: 'TESTKEY123',
      fetch: mockOk(body) as typeof fetch
    });
    const res = await client.searchTv('Severance');
    expect(res.results[0].id).toBe(95396);
    expect(res.results[0].name).toBe('Severance');
  });

  it.each([
    [undefined, '/3/trending/tv/week'],
    ['day' as const, '/3/trending/tv/day'],
    ['week' as const, '/3/trending/tv/week']
  ])('trendingTv(%s) hits %s', async (window, expectedPath) => {
    const f = vi.fn(async (url: string) => {
      expect(new URL(url).pathname).toBe(expectedPath);
      return new Response(
        JSON.stringify({ page: 1, results: [], total_pages: 0, total_results: 0 }),
        { status: 200 }
      );
    });
    const client = createTmdbClient({ apiKey: 'TESTKEY123', fetch: f as unknown as typeof fetch });
    await client.trendingTv(window);
    expect(f).toHaveBeenCalledOnce();
  });

  it('fetches tv detail with seasons', async () => {
    const body = {
      id: 1,
      name: 'X',
      number_of_seasons: 2,
      seasons: [
        { id: 10, season_number: 0, name: 'Specials' },
        { id: 11, season_number: 1, name: 'S1', episode_count: 10 }
      ]
    };
    const client = createTmdbClient({
      apiKey: 'TESTKEY123',
      fetch: mockOk(body) as typeof fetch
    });
    const detail = await client.tvDetail(1);
    expect(detail.seasons?.length).toBe(2);
  });

  it('fetches season detail with episodes', async () => {
    const body = {
      id: 11,
      season_number: 1,
      episodes: [
        {
          id: 100,
          episode_number: 1,
          season_number: 1,
          name: 'Pilot',
          air_date: '2022-02-17',
          runtime: 56
        }
      ]
    };
    const client = createTmdbClient({
      apiKey: 'TESTKEY123',
      fetch: mockOk(body) as typeof fetch
    });
    const season = await client.seasonDetail(1, 1);
    expect(season.episodes).toHaveLength(1);
    expect(season.episodes[0].runtime).toBe(56);
  });

  it.each([
    [70533 as const, 'tvdb_id' as const, '/3/find/70533'],
    ['tt0098936' as const, 'imdb_id' as const, '/3/find/tt0098936']
  ])('findByExternalId(%s, %s) hits %s', async (id, source, expectedPath) => {
    const f = vi.fn(async (url: string) => {
      const u = new URL(url);
      expect(u.pathname).toBe(expectedPath);
      expect(u.searchParams.get('external_source')).toBe(source);
      return new Response(
        JSON.stringify({
          tv_results: [{ id: 1234, name: 'Twin Peaks', first_air_date: '1990-04-08' }]
        }),
        { status: 200 }
      );
    });
    const client = createTmdbClient({ apiKey: 'TESTKEY123', fetch: f as unknown as typeof fetch });
    const hit = await client.findByExternalId(id, source);
    expect(hit?.id).toBe(1234);
  });

  it('findByExternalId returns null when tv_results is empty', async () => {
    const client = createTmdbClient({
      apiKey: 'TESTKEY123',
      fetch: mockOk({ tv_results: [] }) as typeof fetch
    });
    expect(await client.findByExternalId(999999)).toBeNull();
  });

  it('throws TmdbError on non-OK HTTP', async () => {
    const client = createTmdbClient({
      apiKey: 'TESTKEY123',
      fetch: mockFail(401, 'Unauthorized') as typeof fetch
    });
    await expect(client.searchTv('x')).rejects.toBeInstanceOf(TmdbError);
  });

  it('throws on schema mismatch (defensive)', async () => {
    const client = createTmdbClient({
      apiKey: 'TESTKEY123',
      fetch: mockOk({ totally: 'wrong' }) as typeof fetch
    });
    await expect(client.searchTv('x')).rejects.toThrow();
  });
});

/* posterUrl is tested in images.test.ts — tmdb.ts only re-exports it. */

describe('pickBestTrailer', () => {
  function v(opts: Partial<TmdbVideo>): TmdbVideo {
    return {
      id: 'id-' + Math.random(),
      key: 'abc1234',
      name: null,
      site: 'YouTube',
      type: 'Trailer',
      official: false,
      published_at: null,
      size: null,
      ...opts
    };
  }

  it('returns null on empty array', () => {
    expect(pickBestTrailer([])).toBeNull();
  });

  it('returns null when no YouTube entries', () => {
    expect(pickBestTrailer([v({ site: 'Vimeo' })])).toBeNull();
  });

  it('prefers Trailer over Teaser', () => {
    const picked = pickBestTrailer([
      v({ key: 'teaserKey', type: 'Teaser' }),
      v({ key: 'trailerKey', type: 'Trailer' })
    ]);
    expect(picked?.youtubeKey).toBe('trailerKey');
  });

  it('prefers official within the same type', () => {
    const picked = pickBestTrailer([
      v({ key: 'unofficial', type: 'Trailer', official: false }),
      v({ key: 'official', type: 'Trailer', official: true })
    ]);
    expect(picked?.youtubeKey).toBe('official');
  });

  it('prefers more recent published_at as last tiebreaker', () => {
    const picked = pickBestTrailer([
      v({ key: 'oldKey0', type: 'Trailer', official: true, published_at: '2020-01-01' }),
      v({ key: 'newKey0', type: 'Trailer', official: true, published_at: '2024-06-01' })
    ]);
    expect(picked?.youtubeKey).toBe('newKey0');
  });

  it('skips entries with garbage keys', () => {
    const picked = pickBestTrailer([
      v({ key: 'invalid key with spaces', type: 'Trailer', official: true }),
      v({ key: 'cleanKey', type: 'Teaser' })
    ]);
    expect(picked?.youtubeKey).toBe('cleanKey');
  });

  it('skips entries with no matching type', () => {
    expect(pickBestTrailer([v({ type: 'Behind the Scenes' })])).toBeNull();
    expect(pickBestTrailer([v({ type: 'Featurette' })])).toBeNull();
  });
});
