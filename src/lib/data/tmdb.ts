import { z } from 'zod';
export { posterUrl } from '$lib/utils/images';

const BASE_URL = 'https://api.themoviedb.org/3';

export class TmdbError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = 'TmdbError';
  }
}

/* TMDB happily returns explicit `null` (not just missing) for string
 * fields like dates, overviews, or names — particularly for unaired
 * series, single-language records, or partially-curated entries.
 * Every string field that isn't strictly required is .nullable() to
 * stop Zod from blowing up on the load path. */
const SearchTvResult = z.object({
  id: z.number(),
  name: z.string(),
  original_name: z.string().nullable().optional(),
  overview: z.string().nullable().optional(),
  poster_path: z.string().nullable().optional(),
  backdrop_path: z.string().nullable().optional(),
  first_air_date: z.string().nullable().optional(),
  popularity: z.number().optional()
});

const SearchTvResponse = z.object({
  page: z.number(),
  results: z.array(SearchTvResult),
  total_pages: z.number(),
  total_results: z.number()
});

const TvDetail = z.object({
  id: z.number(),
  name: z.string(),
  original_name: z.string().nullable().optional(),
  overview: z.string().nullable().optional(),
  poster_path: z.string().nullable().optional(),
  backdrop_path: z.string().nullable().optional(),
  first_air_date: z.string().nullable().optional(),
  last_air_date: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  number_of_seasons: z.number().nullable().optional(),
  number_of_episodes: z.number().nullable().optional(),
  episode_run_time: z.array(z.number()).optional(),
  vote_average: z.number().nullable().optional(),
  vote_count: z.number().nullable().optional(),
  /* Genres / origin / language let us detect anime — Japanese
   * Animation gets MAL/Jikan ratings added, everything else stays on
   * the TMDB / OMDb / TVMaze sources. */
  genres: z.array(z.object({ id: z.number(), name: z.string() })).optional(),
  original_language: z.string().nullable().optional(),
  origin_country: z.array(z.string()).optional(),
  networks: z.array(z.object({ id: z.number(), name: z.string() })).optional(),
  seasons: z
    .array(
      z.object({
        id: z.number(),
        season_number: z.number(),
        name: z.string().nullable().optional(),
        overview: z.string().nullable().optional(),
        air_date: z.string().nullable().optional(),
        episode_count: z.number().nullable().optional(),
        poster_path: z.string().nullable().optional()
      })
    )
    .optional()
});

const SeasonDetail = z.object({
  id: z.number(),
  season_number: z.number(),
  name: z.string().nullable().optional(),
  overview: z.string().nullable().optional(),
  air_date: z.string().nullable().optional(),
  poster_path: z.string().nullable().optional(),
  episodes: z.array(
    z.object({
      id: z.number(),
      episode_number: z.number(),
      season_number: z.number(),
      name: z.string().nullable().optional(),
      overview: z.string().nullable().optional(),
      air_date: z.string().nullable().optional(),
      runtime: z.number().nullable().optional(),
      still_path: z.string().nullable().optional()
    })
  )
});

const ExternalIds = z.object({
  imdb_id: z.string().nullable().optional(),
  tvdb_id: z.number().nullable().optional()
});

export type TmdbSearchResult = z.infer<typeof SearchTvResult>;
export type TmdbTvDetail = z.infer<typeof TvDetail>;
export type TmdbSeasonDetail = z.infer<typeof SeasonDetail>;
export type TmdbExternalIds = z.infer<typeof ExternalIds>;

export interface TmdbClientOptions {
  apiKey: string;
  language?: string;
  fetch?: typeof fetch;
}

export function createTmdbClient(opts: TmdbClientOptions) {
  if (!opts.apiKey || opts.apiKey.length < 8) {
    throw new TmdbError(401, 'Missing TMDB API key');
  }
  const lang = opts.language ?? 'fr-FR';
  const f = opts.fetch ?? globalThis.fetch;

  async function call<T>(
    path: string,
    params: Record<string, string>,
    schema: z.ZodType<T>
  ): Promise<T> {
    const url = new URL(`${BASE_URL}${path}`);
    url.searchParams.set('api_key', opts.apiKey);
    url.searchParams.set('language', lang);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }

    const res = await f(url.toString());
    if (!res.ok) {
      throw new TmdbError(res.status, `TMDB request failed: ${res.status} ${res.statusText}`);
    }
    const json = await res.json();
    return schema.parse(json);
  }

  return {
    searchTv: (query: string) =>
      call('/search/tv', { query, include_adult: 'false' }, SearchTvResponse),
    trendingTv: (window: 'day' | 'week' = 'week') =>
      call(`/trending/tv/${window}`, {}, SearchTvResponse),
    tvDetail: (id: number) => call(`/tv/${id}`, {}, TvDetail),
    seasonDetail: (id: number, seasonNumber: number) =>
      call(`/tv/${id}/season/${seasonNumber}`, {}, SeasonDetail),
    externalIds: (id: number) => call(`/tv/${id}/external_ids`, {}, ExternalIds)
  };
}

export type TmdbClient = ReturnType<typeof createTmdbClient>;
