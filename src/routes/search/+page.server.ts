import type { PageServerLoad } from './$types';
import { IS_LOCAL } from '$lib/config';
import { tmdbLanguageFromStored } from '$lib/i18n';

export interface SearchResult {
  id: number;
  name: string;
  year: string | null;
  overview: string;
  poster: string | null;
}

/* Hard cap on user-supplied search query length. TMDB's /search/tv
 * silently accepts anything but ignores text past ~250 chars; refusing
 * unbounded queries here closes a "burn quota with tiny payloads"
 * vector that's otherwise gated only by the rate-limiter (60 burst). */
const MAX_QUERY_LEN = 100;

export const load: PageServerLoad = async ({ url }) => {
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, MAX_QUERY_LEN);
  if (IS_LOCAL) {
    return { q, hasKey: false, results: [] as SearchResult[], error: undefined };
  }
  const { serverDb } = await import('$lib/server/db');
  const { getSetting } = await import('$lib/data/queries');
  const { getTmdbKey } = await import('$lib/server/api-helpers');
  const { createTmdbClient, posterUrl } = await import('$lib/data/tmdb');

  const [effectiveKey, storedLocale] = await Promise.all([
    getTmdbKey(serverDb),
    getSetting(serverDb, 'locale')
  ]);
  if (!effectiveKey) {
    return { q, hasKey: false, results: [] as SearchResult[], error: undefined };
  }
  const language = tmdbLanguageFromStored(storedLocale);
  const tmdb = createTmdbClient({ apiKey: effectiveKey, language });
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
