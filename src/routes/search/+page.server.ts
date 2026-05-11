import type { PageServerLoad } from './$types';
import { createTmdbClient, posterUrl } from '$lib/server/tmdb';
import { getSetting } from '$lib/server/db/queries';

export interface SearchResult {
  id: number;
  name: string;
  year: string | null;
  overview: string;
  poster: string | null;
}

export const load: PageServerLoad = async ({ url }) => {
  const q = (url.searchParams.get('q') ?? '').trim();
  const apiKey = (await getSetting('tmdb.api_key')) ?? process.env.EPISODE_TMDB_API_KEY ?? '';

  const empty: SearchResult[] = [];
  if (!apiKey) {
    return { q, hasKey: false, results: empty, error: undefined as string | undefined };
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
    return { q, hasKey: true, results, error: undefined as string | undefined };
  } catch (err) {
    return {
      q,
      hasKey: true,
      results: empty,
      error: err instanceof Error ? err.message : 'TMDB error'
    };
  }
};
