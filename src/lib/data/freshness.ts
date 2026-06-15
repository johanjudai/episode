/**
 * Background freshness sweep for followed series.
 *
 * The home view only ever reads the local DB, and nothing re-syncs a
 * followed series on its own — so a show you finished and never reopen
 * would never resurface when a new season drops two years later. This
 * sweep closes that gap *cheaply*:
 *
 *   - It runs fire-and-forget from the home loader (never blocks render).
 *   - A persisted cooldown caps it to one sweep per COOLDOWN_MS, so
 *     hammering the home page doesn't fan out to TMDB.
 *   - Each sweep only looks at series not synced for STALE_MS, oldest
 *     first, and at most MAX_PER_SWEEP of them — so a large library is
 *     rotated through a few series at a time rather than all at once.
 *   - Per series it costs a SINGLE light `tvDetail` call; the expensive
 *     full season sync only fires when the season/episode count actually
 *     grew. The cheap check touches `lastSyncedAt` either way, so a
 *     checked series rotates out of the stale set until next time.
 *
 * Budget: at most MAX_PER_SWEEP upstream calls every COOLDOWN_MS (plus one
 * full sync per series that genuinely gained content). With the defaults
 * that's ≤ 8 requests / 12 h in the common steady state.
 */
import type { Db } from './db-types';
import { createTmdbClient, type TmdbClient } from './tmdb';
import { getFollowedSeries, getSetting } from './queries';
import { setSetting, updateSeriesSyncState } from './mutations';
import { syncSeriesFull } from './sync';

const COOLDOWN_KEY = 'bg_resync.last_at';
/** At most one sweep per this window, persisted so it survives restarts. */
const COOLDOWN_MS = 12 * 60 * 60 * 1000;
/** Only re-check series not synced within this window. */
const STALE_MS = 2 * 24 * 60 * 60 * 1000;
/** Hard cap on series checked (= upstream tvDetail calls) per sweep. */
const MAX_PER_SWEEP = 8;

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
  /** Injectable deep-sync for the growth path; defaults to syncSeriesFull.
   *  Exposed for tests so the suite stays offline. */
  deepSync?: (tmdbId: number) => Promise<void>;
}

export interface FreshnessResult {
  /** Whether the sweep actually ran (false = skipped via cooldown/guard). */
  ran: boolean;
  /** Number of series checked against TMDB this sweep. */
  checked: number;
  /** Number of series that gained content and were deep-synced. */
  updated: number;
}

/**
 * Re-check the stalest followed series for newly-released content and pull
 * it into the local DB. Safe to call on every home load — it self-throttles.
 */
export async function resyncStaleFollowedSeries(
  db: Db,
  apiKey: string,
  opts: FreshnessOptions = {}
): Promise<FreshnessResult> {
  if (sweeping) return { ran: false, checked: 0, updated: 0 };

  const now = opts.now ?? new Date();
  const nowMs = now.getTime();

  const lastRaw = await getSetting(db, COOLDOWN_KEY);
  const last = lastRaw ? Number(lastRaw) : 0;
  if (Number.isFinite(last) && nowMs - last < COOLDOWN_MS) {
    return { ran: false, checked: 0, updated: 0 };
  }

  sweeping = true;
  try {
    /* Claim the cooldown up-front so a sibling request that arrives mid-sweep
     * bails out instead of double-running. */
    await setSetting(db, COOLDOWN_KEY, String(nowMs));

    const followed = await getFollowedSeries(db);
    const stale = followed
      .filter((s) => nowMs - (s.lastSyncedAt ? s.lastSyncedAt.getTime() : 0) >= STALE_MS)
      .sort((a, b) => (a.lastSyncedAt?.getTime() ?? 0) - (b.lastSyncedAt?.getTime() ?? 0))
      .slice(0, MAX_PER_SWEEP);

    if (stale.length === 0) return { ran: true, checked: 0, updated: 0 };

    const client = opts.client ?? createTmdbClient({ apiKey, language: opts.language });
    const deepSync =
      opts.deepSync ?? ((tmdbId: number) => syncSeriesFull(db, apiKey, tmdbId, { language: opts.language }));

    let updated = 0;
    for (const s of stale) {
      try {
        const detail = await client.tvDetail(s.tmdbId);
        const grew =
          (detail.number_of_episodes ?? 0) > (s.numberOfEpisodes ?? 0) ||
          (detail.number_of_seasons ?? 0) > (s.numberOfSeasons ?? 0);

        if (grew) {
          /* Non-refresh full sync: existing seasons short-circuit on
           * `seasonExists`, so only the genuinely new season(s) hit TMDB. */
          await deepSync(s.tmdbId);
          await updateSeriesSyncState(db, s.tmdbId, now, {
            numberOfSeasons: detail.number_of_seasons ?? null,
            numberOfEpisodes: detail.number_of_episodes ?? null,
            status: detail.status ?? null,
            lastAirDate: detail.last_air_date ?? null
          });
          updated++;
        } else {
          /* No change — just rotate it out of the stale set. */
          await updateSeriesSyncState(db, s.tmdbId, now);
        }
      } catch (err) {
        console.warn(`[freshness] check failed for series ${s.tmdbId} (${s.name}):`, err);
      }
    }

    return { ran: true, checked: stale.length, updated };
  } finally {
    sweeping = false;
  }
}
