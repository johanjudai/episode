/**
 * Tiny OMDb (omdbapi.com) client. OMDb returns the Rotten Tomatoes and
 * IMDb scores attached to a single title, looked up by IMDb ID (`tt12345`).
 *
 * We use it to enrich the series page with non-TMDB ratings — TMDB doesn't
 * expose RT/IMDb scores directly. Free tier: 1000 calls/day with a key.
 *
 * The same code runs in Node (server target) and in the browser (local
 * target). OMDb sends `Access-Control-Allow-Origin: *`, so client-side calls
 * are fine — no CORS proxy needed.
 */
import { z } from 'zod';

const BASE_URL = 'https://www.omdbapi.com/';

export class OmdbError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = 'OmdbError';
  }
}

const Rating = z.object({
  Source: z.string(),
  Value: z.string()
});

const OmdbByIdResponse = z.union([
  z.object({
    Response: z.literal('True'),
    Title: z.string().optional(),
    imdbRating: z.string().optional(),
    imdbVotes: z.string().optional(),
    Metascore: z.string().optional(),
    Ratings: z.array(Rating).optional()
  }),
  z.object({
    Response: z.literal('False'),
    Error: z.string().optional()
  })
]);

export type OmdbResponse = z.infer<typeof OmdbByIdResponse>;

export interface ExternalRating {
  source: 'imdb' | 'rottentomatoes' | 'metacritic';
  value: string;
  raw: string;
}

export interface OmdbClientOptions {
  apiKey: string;
  fetch?: typeof fetch;
}

export function createOmdbClient(opts: OmdbClientOptions) {
  if (!opts.apiKey || opts.apiKey.length < 4) {
    throw new OmdbError(401, 'Missing OMDb API key');
  }
  const f = opts.fetch ?? globalThis.fetch;

  return {
    async byImdbId(imdbId: string): Promise<OmdbResponse> {
      const url = new URL(BASE_URL);
      url.searchParams.set('apikey', opts.apiKey);
      url.searchParams.set('i', imdbId);
      url.searchParams.set('tomatoes', 'true');
      const res = await f(url.toString());
      if (!res.ok) {
        throw new OmdbError(res.status, `OMDb request failed: ${res.status} ${res.statusText}`);
      }
      const json = await res.json();
      return OmdbByIdResponse.parse(json);
    }
  };
}

export type OmdbClient = ReturnType<typeof createOmdbClient>;

/**
 * Pull RT / IMDb / Metacritic from an OMDb response into a normalized
 * `ExternalRating[]`. Skips entries we can't parse, so it's safe to call
 * even when the upstream is missing some scores.
 */
export function extractExternalRatings(resp: OmdbResponse): ExternalRating[] {
  if (resp.Response !== 'True') return [];
  const out: ExternalRating[] = [];
  if (resp.imdbRating && resp.imdbRating !== 'N/A') {
    out.push({ source: 'imdb', value: `${resp.imdbRating}/10`, raw: resp.imdbRating });
  }
  for (const r of resp.Ratings ?? []) {
    if (r.Source === 'Rotten Tomatoes' && r.Value && r.Value !== 'N/A') {
      out.push({ source: 'rottentomatoes', value: r.Value, raw: r.Value });
    } else if (r.Source === 'Metacritic' && r.Value && r.Value !== 'N/A') {
      out.push({ source: 'metacritic', value: r.Value, raw: r.Value });
    }
  }
  return out;
}
