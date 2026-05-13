/**
 * TVMaze client — free, no API key required.
 *
 * https://www.tvmaze.com/api  (publicly hosted, generous rate limit
 * for casual use, CORS-enabled so it works from the browser too).
 *
 * We use it as a no-key supplement to TMDB: it provides a community
 * rating (1.0 – 10.0) for most TV shows that we can display alongside
 * the OMDb / TMDB scores. Lookup is done via the show's IMDb id
 * (which TMDB exposes through /tv/{id}/external_ids).
 */
import { z } from 'zod';

const BASE_URL = 'https://api.tvmaze.com';

const TvmazeShow = z.object({
  id: z.number(),
  name: z.string(),
  rating: z
    .object({
      average: z.number().nullable().optional()
    })
    .optional(),
  externals: z
    .object({
      imdb: z.string().nullable().optional(),
      thetvdb: z.number().nullable().optional()
    })
    .optional()
});

export type TvmazeShow = z.infer<typeof TvmazeShow>;

export class TvmazeError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = 'TvmazeError';
  }
}

export interface TvmazeClientOptions {
  fetch?: typeof fetch;
}

export function createTvmazeClient(opts: TvmazeClientOptions = {}) {
  const f = opts.fetch ?? globalThis.fetch;

  async function call<T>(path: string, schema: z.ZodType<T>): Promise<T | null> {
    const res = await f(`${BASE_URL}${path}`);
    /* 404 just means TVMaze doesn't know this title — not an error. */
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new TvmazeError(res.status, `TVMaze request failed: ${res.status} ${res.statusText}`);
    }
    return schema.parse(await res.json());
  }

  return {
    /** Look up a show by IMDb id (e.g. "tt1190634"). Returns null when no match. */
    byImdbId: (imdbId: string) => call(`/lookup/shows?imdb=${imdbId}`, TvmazeShow),
    /** Fallback search by name — returns the first hit, or null. */
    async searchByName(name: string): Promise<TvmazeShow | null> {
      const res = await f(`${BASE_URL}/search/shows?q=${encodeURIComponent(name)}`);
      if (!res.ok) return null;
      const data = (await res.json()) as Array<{ show: unknown }>;
      const first = data?.[0]?.show;
      if (!first) return null;
      const parsed = TvmazeShow.safeParse(first);
      return parsed.success ? parsed.data : null;
    }
  };
}

export type TvmazeClient = ReturnType<typeof createTvmazeClient>;
