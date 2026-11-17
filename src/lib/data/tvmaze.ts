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
 *
 * It is also the source of per-episode release instants (`airstamp`), which
 * TMDB's bare `air_date` cannot give — see release-times.ts.
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

const TvmazeEpisode = z.object({
  season: z.number(),
  /* null on specials. */
  number: z.number().nullable(),
  airdate: z.string().nullable().optional(),
  /* Empty when TVMaze only knows the day; `airstamp` is then a noon-UTC placeholder. */
  airtime: z.string().nullable().optional(),
  airstamp: z.string().nullable().optional()
});

const TvmazeSchedule = z.object({
  id: z.number(),
  network: z.object({ name: z.string() }).nullable().optional(),
  webChannel: z.object({ name: z.string() }).nullable().optional(),
  _embedded: z.object({ episodes: z.array(TvmazeEpisode) })
});

export type TvmazeShow = z.infer<typeof TvmazeShow>;
export type TvmazeEpisode = z.infer<typeof TvmazeEpisode>;
export type TvmazeSchedule = z.infer<typeof TvmazeSchedule>;

/* TVMaze allows ~20 calls / 10 s per IP and asks clients to back off on 429. */
const RETRY_DELAYS_MS = [2000, 4000];

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
  /** Waits before each 429 retry; injectable so tests don't sleep. */
  retryDelaysMs?: readonly number[];
  /** Spacing between requests, for bulk callers (the freshness sweep). */
  minIntervalMs?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createTvmazeClient(opts: TvmazeClientOptions = {}) {
  const f = opts.fetch ?? globalThis.fetch;
  const retryDelays = opts.retryDelaysMs ?? RETRY_DELAYS_MS;
  let lastAt = 0;

  async function paced(url: string): Promise<Response> {
    const wait = lastAt + (opts.minIntervalMs ?? 0) - Date.now();
    if (wait > 0) await sleep(wait);
    lastAt = Date.now();
    return f(url);
  }

  async function call<T>(path: string, schema: z.ZodType<T>): Promise<T | null> {
    let res = await paced(`${BASE_URL}${path}`);
    for (const delay of retryDelays) {
      if (res.status !== 429) break;
      await sleep(delay);
      res = await paced(`${BASE_URL}${path}`);
    }
    /* 404 just means TVMaze doesn't know this title — not an error. */
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new TvmazeError(res.status, `TVMaze request failed: ${res.status} ${res.statusText}`);
    }
    return schema.parse(await res.json());
  }

  return {
    /** Look up a show by IMDb id (e.g. "tt1190634"). Returns null when no match.
     *  The id is whitelisted (tt + 7-10 digits) before being injected into the
     *  query string, so a malformed upstream value can't mess with the URL. */
    byImdbId: (imdbId: string) => {
      if (!/^tt\d{7,10}$/.test(imdbId)) return Promise.resolve(null);
      return call(`/lookup/shows?imdb=${encodeURIComponent(imdbId)}`, TvmazeShow);
    },
    /** Look up a show by TheTVDB id. Returns null when no match. */
    byTvdbId: (tvdbId: number) => {
      if (!Number.isInteger(tvdbId) || tvdbId <= 0) return Promise.resolve(null);
      return call(`/lookup/shows?thetvdb=${tvdbId}`, TvmazeShow);
    },
    /** A show's broadcaster and full episode list (specials excluded), or null if unknown. */
    schedule: (showId: number) => call(`/shows/${showId}?embed=episodes`, TvmazeSchedule),
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
