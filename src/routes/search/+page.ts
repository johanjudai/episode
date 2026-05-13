import type { PageLoad } from './$types';
import { browser } from '$app/environment';
import { IS_LOCAL } from '$lib/config';
import type { SearchResult } from './+page.server';

export const load: PageLoad = async ({ data, url }) => {
  if (!IS_LOCAL) return { ...data };
  const q = (url.searchParams.get('q') ?? '').trim();
  if (!browser) return { q, hasKey: false, results: [] as SearchResult[], error: undefined };

  const { getDb } = await import('$lib/db');
  const { getSetting } = await import('$lib/data/queries');
  const { createTmdbClient, posterUrl } = await import('$lib/data/tmdb');

  const db = await getDb();
  const [apiKey, storedLocale] = await Promise.all([
    getSetting(db, 'tmdb.api_key'),
    getSetting(db, 'locale')
  ]);
  if (!apiKey) return { q, hasKey: false, results: [] as SearchResult[], error: undefined };

  const language = storedLocale === 'en' ? 'en-US' : 'fr-FR';
  const tmdb = createTmdbClient({ apiKey, language });
  try {
    const resp = q ? await tmdb.searchTv(q) : await tmdb.trendingTv('week');
    const results: SearchResult[] = resp.results.slice(0, 20).map((r) => ({
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
