import type { PageServerLoad } from './$types';
import { IS_LOCAL } from '$lib/config';

export interface SearchResult {
  id: number;
  name: string;
  year: string | null;
  overview: string;
  poster: string | null;
}

export const load: PageServerLoad = async ({ url }) => {
  const q = (url.searchParams.get('q') ?? '').trim();
  if (IS_LOCAL) {
    return { q, hasKey: false, results: [] as SearchResult[], error: undefined };
  }
  const { serverDb } = await import('$lib/server/db');
  const { getSetting } = await import('$lib/data/queries');
  const { createTmdbClient, posterUrl } = await import('$lib/data/tmdb');

  const apiKey =
    (await getSetting(serverDb, 'tmdb.api_key')) ?? process.env.EPISODE_TMDB_API_KEY ?? '';
  if (!apiKey) {
    return { q, hasKey: false, results: [] as SearchResult[], error: undefined };
  }

  const tmdb = createTmdbClient({ apiKey });
  try {
    const data = q ? await tmdb.searchTv(q) : await tmdb.trendingTv('week');
    const results: SearchResult[] = data.results.slice(0, 20).map((r) => ({
      id: r.id,
      name: r.name,
      year: r.first_air_date?.slice(0, 4) ?? null,
      overview: r.overview ?? '',
      poster: posterUrl(r.poster_path, 'w342')
    }));
    return { q, hasKey: true, results, error: undefined };
  } catch (err) {
    return {
      q,
      hasKey: true,
      results: [] as SearchResult[],
      error: err instanceof Error ? err.message : 'TMDB error'
    };
  }
};
