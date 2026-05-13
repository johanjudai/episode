/**
 * Jikan — unofficial REST proxy in front of MyAnimeList data.
 *
 * https://docs.api.jikan.moe/  (free, no key, rate-limited to 3 req/s
 * and 60 req/min, CORS-enabled so it works from the browser too).
 *
 * Used only when a series is detected as anime (Japanese origin +
 * Animation genre, see ratings.ts) — adds a MAL community score
 * (1-10) to the chip row.
 */
import { z } from 'zod';

const BASE_URL = 'https://api.jikan.moe/v4';

const JikanAnime = z.object({
  mal_id: z.number(),
  title: z.string(),
  title_english: z.string().nullable().optional(),
  score: z.number().nullable().optional(),
  scored_by: z.number().nullable().optional(),
  year: z.number().nullable().optional(),
  type: z.string().nullable().optional()
});
const JikanSearchResponse = z.object({
  data: z.array(JikanAnime)
});

export type JikanAnime = z.infer<typeof JikanAnime>;

export class MalError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = 'MalError';
  }
}

export interface MalClientOptions {
  fetch?: typeof fetch;
}

export function createMalClient(opts: MalClientOptions = {}) {
  const f = opts.fetch ?? globalThis.fetch;

  return {
    /**
     * Search MAL by title. `year` (optional) narrows ambiguous matches —
     * e.g. multiple "Frieren"s exist; pinning to 2023 picks the right one.
     * Returns the highest-scored match (typically the canonical TV entry).
     */
    async searchByTitle(title: string, year?: number): Promise<JikanAnime | null> {
      const url = new URL(`${BASE_URL}/anime`);
      url.searchParams.set('q', title);
      url.searchParams.set('limit', '5');
      url.searchParams.set('type', 'tv');
      if (year) url.searchParams.set('start_date', `${year}-01-01`);
      const res = await f(url.toString());
      if (!res.ok) return null;
      const parsed = JikanSearchResponse.safeParse(await res.json());
      if (!parsed.success) return null;
      const candidates = parsed.data.data.filter((a) => typeof a.score === 'number' && a.score > 0);
      if (candidates.length === 0) return null;
      /* Year-aware filtering — keep the closest year match when one is
       * provided, otherwise just pick the highest-scored entry. */
      const sorted = year
        ? candidates.sort(
            (a, b) =>
              Math.abs((a.year ?? 9999) - year) - Math.abs((b.year ?? 9999) - year) ||
              (b.score ?? 0) - (a.score ?? 0)
          )
        : candidates.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      return sorted[0];
    }
  };
}

export type MalClient = ReturnType<typeof createMalClient>;
