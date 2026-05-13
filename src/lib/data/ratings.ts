/**
 * Aggregates ratings for a series from every source we know about:
 *
 *   - TMDB (vote_average)        — always, no extra call
 *   - OMDb (RT / IMDb / Meta)    — when an OMDb key is configured
 *   - TVMaze (community)         — free, no key, via the IMDb id
 *   - MAL via Jikan              — free, no key, only when the series
 *                                  is detected as anime (TMDB genre +
 *                                  Japanese origin language)
 *
 * Same function on server and client — passes a fetch impl through to
 * the per-source clients. Failures on any optional source are
 * non-fatal; the chip simply doesn't render.
 */
import type { TmdbTvDetail } from './tmdb';
import { createTmdbClient } from './tmdb';
import { createOmdbClient, extractExternalRatings, type ExternalRating } from './omdb';
import { createTvmazeClient } from './tvmaze';
import { createMalClient } from './mal';

export type RatingSource = ExternalRating['source'] | 'tvmaze' | 'mal';

export interface AggregatedRating {
  source: RatingSource;
  value: string;
  raw: string;
}

export interface SeriesRatings {
  tmdb: { average: number; count: number } | null;
  external: AggregatedRating[];
}

/**
 * Anime heuristic: Japanese origin AND animation genre.
 *
 *  - genre id 16 = "Animation" in TMDB's TV genre list
 *  - original_language 'ja' is the strongest signal; we also accept
 *    `origin_country` containing 'JP' as a back-up because some TMDB
 *    entries miss the language field.
 */
export function detectAnime(detail: TmdbTvDetail): boolean {
  const isAnimation = (detail.genres ?? []).some((g) => g.id === 16);
  if (!isAnimation) return false;
  if (detail.original_language === 'ja') return true;
  if ((detail.origin_country ?? []).includes('JP')) return true;
  return false;
}

export interface FetchRatingsArgs {
  tmdbId: number;
  tmdbApiKey: string;
  omdbApiKey?: string | null;
  /** Pre-fetched TMDB detail (saves a round-trip if the caller has it). */
  tmdbDetail: TmdbTvDetail;
  fetchImpl?: typeof fetch;
}

export async function fetchSeriesRatings(args: FetchRatingsArgs): Promise<SeriesRatings> {
  const f = args.fetchImpl ?? globalThis.fetch;
  const tmdb = createTmdbClient({ apiKey: args.tmdbApiKey, fetch: f });

  const tmdbVote =
    typeof args.tmdbDetail.vote_average === 'number' && args.tmdbDetail.vote_average > 0
      ? {
          average: args.tmdbDetail.vote_average,
          count: args.tmdbDetail.vote_count ?? 0
        }
      : null;

  /* External IDs are shared by OMDb and TVMaze lookups, so fetch once. */
  let imdbId: string | null = null;
  try {
    const ext = await tmdb.externalIds(args.tmdbId);
    imdbId = ext.imdb_id ?? null;
  } catch {
    imdbId = null;
  }

  const isAnime = detectAnime(args.tmdbDetail);
  const year = args.tmdbDetail.first_air_date
    ? Number(args.tmdbDetail.first_air_date.slice(0, 4))
    : undefined;

  const [omdbResp, tvmazeShow, malAnime] = await Promise.all([
    args.omdbApiKey && imdbId
      ? createOmdbClient({ apiKey: args.omdbApiKey, fetch: f })
          .byImdbId(imdbId)
          .catch(() => null)
      : Promise.resolve(null),
    imdbId
      ? createTvmazeClient({ fetch: f })
          .byImdbId(imdbId)
          .catch(() => null)
      : Promise.resolve(null),
    isAnime
      ? createMalClient({ fetch: f })
          .searchByTitle(args.tmdbDetail.name, Number.isFinite(year) ? year : undefined)
          .catch(() => null)
      : Promise.resolve(null)
  ]);

  const external: AggregatedRating[] = [];

  if (omdbResp) {
    for (const r of extractExternalRatings(omdbResp)) {
      external.push(r);
    }
  }

  if (tvmazeShow && tvmazeShow.rating?.average != null) {
    const avg = tvmazeShow.rating.average;
    external.push({ source: 'tvmaze', value: `${avg.toFixed(1)}/10`, raw: String(avg) });
  }

  if (malAnime && typeof malAnime.score === 'number' && malAnime.score > 0) {
    external.push({
      source: 'mal',
      value: `${malAnime.score.toFixed(1)}/10`,
      raw: String(malAnime.score)
    });
  }

  return { tmdb: tmdbVote, external };
}
