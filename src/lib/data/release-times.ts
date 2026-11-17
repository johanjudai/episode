/**
 * Per-series release instants. TMDB's `air_date` is often the linear-TV date
 * (Dexter: Resurrection lists Sunday, Paramount+ drops it Friday), so TVMaze's
 * per-episode schedule wins when it matches; the airtime.ts guess is the fallback.
 */
import { and, eq, gte } from 'drizzle-orm';
import type { Db } from './db-types';
import { episodes, series } from './schema';
import { createTvmazeClient, type TvmazeClient, type TvmazeSchedule } from './tvmaze';
import { STREAMER_RELEASE, computeReleaseAtMs, releaseTiming } from '$lib/utils/airtime';

/** A TVMaze date further than this from TMDB's means the numbering differs, not the date. */
const MAX_DATE_GAP_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ReleaseTimesOptions {
  /** TheTVDB id from TMDB external_ids; needed only until the TVMaze id is cached. */
  tvdbId?: number | null;
  /** Only episodes airing on/after this day are recomputed. */
  sinceIso: string;
  tvmaze?: Pick<TvmazeClient, 'byTvdbId' | 'schedule'>;
}

type Timing = { timeZone: string; hour: number } | null;

function tvmazeReleaseMs(
  ep: TvmazeSchedule['_embedded']['episodes'][number],
  dayOnlyTiming: Timing
): number | null {
  if (!ep.airdate) return null;
  if (ep.airtime && ep.airstamp) {
    const ms = Date.parse(ep.airstamp);
    return Number.isFinite(ms) ? ms : null;
  }
  /* Day-only: airstamp is a noon-UTC placeholder, not a real time. */
  return computeReleaseAtMs(ep.airdate, dayOnlyTiming?.timeZone, dayOnlyTiming?.hour);
}

function daysApart(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS;
}

/** Recompute release_at for a series' recent/upcoming episodes. Returns the number of rows changed. */
export async function refreshSeriesReleaseTimes(
  db: Db,
  tmdbId: number,
  opts: ReleaseTimesOptions
): Promise<number> {
  const s = db
    .select({
      originCountry: series.originCountry,
      network: series.network,
      tvmazeId: series.tvmazeId
    })
    .from(series)
    .where(eq(series.tmdbId, tmdbId))
    .all()[0];
  if (!s) return 0;

  const rows = db
    .select({
      id: episodes.id,
      seasonNumber: episodes.seasonNumber,
      episodeNumber: episodes.episodeNumber,
      airDate: episodes.airDate,
      releaseAt: episodes.releaseAt
    })
    .from(episodes)
    .where(and(eq(episodes.seriesTmdbId, tmdbId), gte(episodes.airDate, opts.sinceIso)))
    .all();
  if (rows.length === 0) return 0;

  const fallback = releaseTiming(s.originCountry, s.network);

  /* TVMaze is best-effort: any failure keeps the heuristic. */
  let schedule: TvmazeSchedule | null = null;
  try {
    const client = opts.tvmaze ?? createTvmazeClient();
    let tvmazeId = s.tvmazeId;
    if (tvmazeId == null && opts.tvdbId) {
      tvmazeId = (await client.byTvdbId(opts.tvdbId))?.id ?? null;
      if (tvmazeId != null) {
        db.update(series).set({ tvmazeId }).where(eq(series.tmdbId, tmdbId)).run();
      }
    }
    if (tvmazeId != null) schedule = await client.schedule(tvmazeId);
  } catch (err) {
    console.warn(`[release-times] TVMaze lookup failed for series ${tmdbId}:`, err);
  }

  const byCoords = new Map<string, TvmazeSchedule['_embedded']['episodes'][number]>();
  for (const ep of schedule?._embedded.episodes ?? []) {
    if (ep.number != null) byCoords.set(`${ep.season}-${ep.number}`, ep);
  }
  /* TVMaze fixes the day; the hour still comes from the network heuristic. */
  const dayOnlyTiming: Timing = fallback ?? (schedule?.webChannel ? STREAMER_RELEASE : null);

  let changed = 0;
  for (const r of rows) {
    let releaseAt = computeReleaseAtMs(r.airDate, fallback?.timeZone, fallback?.hour);
    const tv = byCoords.get(`${r.seasonNumber}-${r.episodeNumber}`);
    if (tv?.airdate && r.airDate && daysApart(tv.airdate, r.airDate) <= MAX_DATE_GAP_DAYS) {
      releaseAt = tvmazeReleaseMs(tv, dayOnlyTiming) ?? releaseAt;
    }
    if (releaseAt === null || releaseAt === r.releaseAt) continue;
    db.update(episodes).set({ releaseAt }).where(eq(episodes.id, r.id)).run();
    changed++;
  }
  return changed;
}
