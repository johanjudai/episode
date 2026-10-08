/**
 * Background freshness sweep for followed series.
 *
 * The home view only ever reads the local DB, so anything TMDB learns after
 * a series was synced (a newly-listed episode, a date that moved, a new
 * season) only reaches the feed through this sweep:
 *
 *   - It is triggered from the home page (never blocks render) and
 *     self-throttles via a persisted cooldown.
 *   - Running series are re-checked every ACTIVE_STALE_MS; ended/canceled
 *     ones only every ENDED_STALE_MS (they rarely change, but can be revived).
 *     Running series go first, at most MAX_PER_SWEEP per sweep.
 *   - Per series it costs one `tvDetail` call. A season is only re-fetched
 *     when that detail disagrees with the local DB: counts grew (full sync),
 *     or TMDB's last/next aired episode is missing locally or carries a
 *     different date (just those seasons).
 */
import type { Db } from './db-types';
import { createTmdbClient, type TmdbClient, type TmdbTvDetail } from './tmdb';
import { getFollowedSeries, getSetting } from './queries';
import {
  getEpisodeForCoords,
  refreshUpcomingReleaseTimes,
  setSetting,
  updateSeriesSyncState
} from './mutations';
import { syncSeason, syncSeriesFull } from './sync';

const COOLDOWN_KEY = 'bg_resync.last_at';
/** At most one sweep per this window, persisted so it survives restarts. */
const COOLDOWN_MS = 60 * 60 * 1000;
const ACTIVE_STALE_MS = 12 * 60 * 60 * 1000;
const ENDED_STALE_MS = 7 * 24 * 60 * 60 * 1000;
/** Hard cap on series checked (= upstream tvDetail calls) per sweep. */
const MAX_PER_SWEEP = 20;
/** How far back release instants are re-derived (older rows are long released). */
const RELEASE_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
const ENDED_STATUSES = new Set(['Ended', 'Canceled']);

/* Process-/tab-local guard so two concurrent home loads in the same
 * runtime don't launch overlapping sweeps before the persisted cooldown
 * is written. */
let sweeping = false;

export interface FreshnessOptions {
  language?: string;
  /** Reference time; injectable for tests. Defaults to now. */
  now?: Date;
  /** Injectable TMDB client for the cheap check; defaults to a real one. */
  client?: Pick<TmdbClient, 'tvDetail'>;
  /** Injectable deep-sync (offline tests); `seasons` omitted = whole series. */
  deepSync?: (tmdbId: number, seasons?: number[]) => Promise<void>;
}

export interface FreshnessResult {
  /** Whether the sweep actually ran (false = skipped via cooldown/guard). */
  ran: boolean;
  /** Number of series checked against TMDB this sweep. */
  checked: number;
  /** Number of series whose episodes were re-synced. */
  updated: number;
  /** Number of stored release instants corrected by the timing rules. */
  releaseTimesFixed: number;
}

/** Seasons whose last/next aired episode is missing locally or dated differently. */
async function driftedSeasons(db: Db, tmdbId: number, detail: Partial<TmdbTvDetail>): Promise<number[]> {
  const drifted = new Set<number>();
  for (const ref of [detail.last_episode_to_air, detail.next_episode_to_air]) {
    if (!ref || ref.season_number <= 0) continue;
    const local = await getEpisodeForCoords(db, tmdbId, ref.season_number, ref.episode_number);
    if (!local || local.airDate !== (ref.air_date ?? null)) drifted.add(ref.season_number);
  }
  return [...drifted];
}

/**
 * Re-check the stalest followed series for new or re-dated episodes and pull
 * them into the local DB. Safe to call on every home load — it self-throttles.
 */
export async function resyncStaleFollowedSeries(
  db: Db,
  apiKey: string,
  opts: FreshnessOptions = {}
): Promise<FreshnessResult> {
  const skipped = { ran: false, checked: 0, updated: 0, releaseTimesFixed: 0 };
  if (sweeping) return skipped;

  const now = opts.now ?? new Date();
  const nowMs = now.getTime();

  const lastRaw = await getSetting(db, COOLDOWN_KEY);
  const last = lastRaw ? Number(lastRaw) : 0;
  if (Number.isFinite(last) && nowMs - last < COOLDOWN_MS) return skipped;

  sweeping = true;
  try {
    /* Claim the cooldown up-front so a sibling request that arrives mid-sweep
     * bails out instead of double-running. */
    await setSetting(db, COOLDOWN_KEY, String(nowMs));

    const sinceIso = new Date(nowMs - RELEASE_LOOKBACK_MS).toISOString().slice(0, 10);
    const releaseTimesFixed = await refreshUpcomingReleaseTimes(db, sinceIso);

    const isEnded = (status: string | null) => !!status && ENDED_STATUSES.has(status);
    const followed = await getFollowedSeries(db);
    const stale = followed
      .filter((s) => {
        const age = nowMs - (s.lastSyncedAt ? s.lastSyncedAt.getTime() : 0);
        return age >= (isEnded(s.status) ? ENDED_STALE_MS : ACTIVE_STALE_MS);
      })
      .sort(
        (a, b) =>
          Number(isEnded(a.status)) - Number(isEnded(b.status)) ||
          (a.lastSyncedAt?.getTime() ?? 0) - (b.lastSyncedAt?.getTime() ?? 0)
      )
      .slice(0, MAX_PER_SWEEP);

    if (stale.length === 0) return { ran: true, checked: 0, updated: 0, releaseTimesFixed };

    const client = opts.client ?? createTmdbClient({ apiKey, language: opts.language });
    const deepSync =
      opts.deepSync ??
      (async (tmdbId: number, seasons?: number[]) => {
        const syncOpts = { language: opts.language, fillMissing: true };
        if (!seasons) return syncSeriesFull(db, apiKey, tmdbId, syncOpts);
        for (const n of seasons) await syncSeason(db, apiKey, tmdbId, n, syncOpts);
      });

    let updated = 0;
    for (const s of stale) {
      try {
        const detail = await client.tvDetail(s.tmdbId);
        const grew =
          (detail.number_of_episodes ?? 0) > (s.numberOfEpisodes ?? 0) ||
          (detail.number_of_seasons ?? 0) > (s.numberOfSeasons ?? 0);

        if (grew) {
          await deepSync(s.tmdbId);
          updated++;
        } else {
          const seasons = await driftedSeasons(db, s.tmdbId, detail);
          if (seasons.length > 0) {
            await deepSync(s.tmdbId, seasons);
            updated++;
          }
        }
        /* Always refresh status: it decides the cadence (a revived show must
         * leave the slow "ended" lane). */
        await updateSeriesSyncState(db, s.tmdbId, now, {
          numberOfSeasons: detail.number_of_seasons ?? null,
          numberOfEpisodes: detail.number_of_episodes ?? null,
          status: detail.status ?? null,
          lastAirDate: detail.last_air_date ?? null
        });
      } catch (err) {
        console.warn(`[freshness] check failed for series ${s.tmdbId} (${s.name}):`, err);
      }
    }

    return { ran: true, checked: stale.length, updated, releaseTimesFixed };
  } finally {
    sweeping = false;
  }
}
