/**
 * Aggregates ratings for a series from TMDB (vote_average) + OMDb (Rotten
 * Tomatoes, IMDb, Metacritic). Same function on server and client — it
 * takes the keys + a TMDB ID, performs the lookups, and returns a normalized
 * shape consumed by the series page.
 *
 * Failures on the OMDb side are non-fatal — TMDB always works, and if the
 * OMDb key is missing or the IMDb ID isn't found, we just return the TMDB
 * score by itself.
 */
import { createTmdbClient } from './tmdb';
import { createOmdbClient, extractExternalRatings, type ExternalRating } from './omdb';

export interface SeriesRatings {
  tmdb: { average: number; count: number } | null;
  external: ExternalRating[];
}

export async function fetchSeriesRatings(args: {
  tmdbId: number;
  tmdbApiKey: string;
  omdbApiKey?: string | null;
  /** Pre-fetched TMDB vote average / count, so the caller can avoid a second
   *  TMDB detail call when it already has them. */
  tmdbVote?: { average: number; count: number } | null;
  fetchImpl?: typeof fetch;
}): Promise<SeriesRatings> {
  const tmdb = createTmdbClient({ apiKey: args.tmdbApiKey, fetch: args.fetchImpl });

  let tmdbVote = args.tmdbVote ?? null;
  if (!tmdbVote) {
    try {
      const detail = await tmdb.tvDetail(args.tmdbId);
      if (typeof detail.vote_average === 'number' && detail.vote_average > 0) {
        tmdbVote = { average: detail.vote_average, count: detail.vote_count ?? 0 };
      }
    } catch {
      tmdbVote = null;
    }
  }

  let external: ExternalRating[] = [];
  if (args.omdbApiKey) {
    try {
      const ext = await tmdb.externalIds(args.tmdbId);
      if (ext.imdb_id) {
        const omdb = createOmdbClient({ apiKey: args.omdbApiKey, fetch: args.fetchImpl });
        const resp = await omdb.byImdbId(ext.imdb_id);
        external = extractExternalRatings(resp);
      }
    } catch {
      /* swallow — OMDb is best-effort */
    }
  }

  return {
    tmdb: tmdbVote,
    external
  };
}
