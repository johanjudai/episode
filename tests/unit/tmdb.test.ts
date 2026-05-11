import { describe, it, expect, vi } from 'vitest';
import { createTmdbClient, TmdbError, posterUrl } from '$lib/server/tmdb';

function mockOk(body: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
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

  it('calls /trending/tv/week by default', async () => {
    const f = vi.fn(async (url: string) => {
      const u = new URL(url);
      expect(u.pathname).toBe('/3/trending/tv/week');
      return new Response(
        JSON.stringify({ page: 1, results: [], total_pages: 0, total_results: 0 }),
        { status: 200 }
      );
    });
    const client = createTmdbClient({ apiKey: 'TESTKEY123', fetch: f as unknown as typeof fetch });
    await client.trendingTv();
    expect(f).toHaveBeenCalledOnce();
  });

  it('supports trending day window', async () => {
    const f = vi.fn(async (url: string) => {
      expect(new URL(url).pathname).toBe('/3/trending/tv/day');
      return new Response(
        JSON.stringify({ page: 1, results: [], total_pages: 0, total_results: 0 }),
        { status: 200 }
      );
    });
    const client = createTmdbClient({ apiKey: 'TESTKEY123', fetch: f as unknown as typeof fetch });
    await client.trendingTv('day');
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
        { id: 100, episode_number: 1, season_number: 1, name: 'Pilot', air_date: '2022-02-17', runtime: 56 }
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

describe('posterUrl', () => {
  it('builds w342 URL by default', () => {
    expect(posterUrl('/abc.jpg')).toBe('https://image.tmdb.org/t/p/w342/abc.jpg');
  });
  it('supports w185 and w500', () => {
    expect(posterUrl('/x.jpg', 'w185')).toBe('https://image.tmdb.org/t/p/w185/x.jpg');
    expect(posterUrl('/x.jpg', 'w500')).toBe('https://image.tmdb.org/t/p/w500/x.jpg');
  });
  it('returns null for null/undefined/empty', () => {
    expect(posterUrl(null)).toBeNull();
    expect(posterUrl(undefined)).toBeNull();
    expect(posterUrl('')).toBeNull();
  });
});
