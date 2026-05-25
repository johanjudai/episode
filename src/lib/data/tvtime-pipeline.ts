/**
 * TV Time import orchestration.
 *
 * Two phases:
 *  1. resolve TheTVDB → TMDB and sync series metadata (foreground —
 *     once it completes, the user already sees their library);
 *  2. walk the watch history and mark each episode as watched.
 *
 * Each phase reports progress through an optional callback so the UI
 * (or a server-side persistence hook) can display a live counter.
 *
 * Cancellation: the pipeline currently runs to completion once
 * started — there's no AbortSignal plumbing. Closing the tab during
 * the server-target run leaves the import in flight on the server;
 * the next polling GET will still surface the final summary. For the
 * local target, the work dies with the page. Acceptable for now
 * because phase 2 is fast (~5-30s for typical histories); revisit if
 * we add full background-job UX.
 *
 * The pipeline is target-agnostic: it operates on a `Db` handle so
 * both the server build (Node + better-sqlite3) and the local build
 * (browser + sql.js) call into the same code path.
 */
import type { Db } from './db-types';
import { createTmdbClient, TmdbError, type TmdbSearchResult } from './tmdb';
import { syncSeriesFull } from './sync';
import { getEpisodeForCoords, markEpisodeWatched, setSeriesFollowDates } from './mutations';
import {
  normalizeSeriesName,
  parseFollowedShows,
  parseTrackingRecordsV1,
  parseTrackingRecordsV2,
  mergeWatchHistory,
  TvTimeImportError,
  type TvTimeFollow,
  type MergedHistory
} from './tvtime-import';
import { extractTvTimeZip, TvTimeZipError } from './tvtime-zip';

export interface ParsedExport {
  follows: TvTimeFollow[];
  history: MergedHistory;
}

export interface ImportProgress {
  phase: 'parse' | 'resolve' | 'sync' | 'mark' | 'done';
  current: number;
  total: number;
  detail?: string;
}

export type ProgressCallback = (p: ImportProgress) => void;

export interface Phase1Summary {
  /** TheTVDB id → TMDB id, for every series we successfully MATCHED on TMDB
   *  (sync may still have failed afterwards). */
  tvdbToTmdb: Map<number, number>;
  /** normalized series name → TMDB id. Phase 2 uses the normalized
   *  lookup so apostrophe / case / whitespace variations between
   *  followed_tv_show.csv and tracking-prod-records*.csv don't drop
   *  watches on the floor. */
  nameToTmdb: Map<string, number>;
  /** Series matched on TMDB (via /find or fallback searchTv). */
  seriesMatched: number;
  /** Series whose metadata + episodes were successfully synced. */
  seriesSynced: number;
  /** Series matched on TMDB but whose subsequent sync threw. Their
   *  name mapping still lives in nameToTmdb (so phase 2 *can* try to
   *  mark episodes), but the local DB has no episode rows so those
   *  marks will count as skipped. The user can retry via the normal
   *  follow flow. */
  syncFailed: { name: string; tvdbId: number; tmdbId: number }[];
  /** Series we could not match on TMDB at all (no fallback hit). */
  unresolved: { name: string; tvdbId: number }[];
}

export interface Phase2Summary {
  watchesApplied: number;
  watchesSkipped: number;
}

/**
 * Decrypt the ZIP and parse the relevant CSVs into in-memory records.
 *
 * Failures of the optional CSVs (tracking-prod-records.csv,
 * user_tv_show_data.csv) are silent — they're complements. Failure to
 * find `followed_tv_show.csv` is fatal: without the TheTVDB IDs we
 * can't pivot to TMDB.
 */
export async function parseTvTimeExport(
  file: Blob,
  password: string,
  onProgress?: ProgressCallback
): Promise<ParsedExport> {
  onProgress?.({ phase: 'parse', current: 0, total: 1 });
  const extracted = await extractTvTimeZip(file, password);
  const followsCsv = extracted['followed_tv_show.csv'];
  if (!followsCsv) {
    throw new TvTimeImportError(
      'MISSING_FOLLOWED_CSV',
      'followed_tv_show.csv is missing from the export'
    );
  }
  const follows = parseFollowedShows(followsCsv);
  const v1 = extracted['tracking-prod-records.csv']
    ? parseTrackingRecordsV1(extracted['tracking-prod-records.csv']!)
    : [];
  const v2 = extracted['tracking-prod-records-v2.csv']
    ? parseTrackingRecordsV2(extracted['tracking-prod-records-v2.csv']!)
    : [];
  const history = mergeWatchHistory(v1, v2);
  onProgress?.({ phase: 'parse', current: 1, total: 1 });
  return { follows, history };
}

/* Re-export so callers handling the import flow only need to import
 * from this module — they don't have to know about the ZIP/CSV split. */
export { TvTimeImportError, TvTimeZipError };

/**
 * Phase 1 — for every followed series, resolve TheTVDB → TMDB and
 * call syncSeriesFull. Archived series are still imported (so the
 * watch history can attach to them) but marked unfollowed afterwards.
 *
 * Series are processed SEQUENTIALLY to stay well under TMDB's
 * 40 req/10s rate limit. syncSeriesFull internally parallelizes
 * season fetches, which is where the per-series latency lives.
 */
export async function importPhase1(
  db: Db,
  apiKey: string,
  language: string,
  parsed: ParsedExport,
  onProgress?: ProgressCallback
): Promise<Phase1Summary> {
  const tmdb = createTmdbClient({ apiKey, language });
  const tvdbToTmdb = new Map<number, number>();
  const nameToTmdb = new Map<string, number>();
  const unresolved: { name: string; tvdbId: number }[] = [];
  const syncFailed: { name: string; tvdbId: number; tmdbId: number }[] = [];
  let synced = 0;

  const total = parsed.follows.length;
  onProgress?.({ phase: 'resolve', current: 0, total });

  for (let i = 0; i < total; i++) {
    const follow = parsed.follows[i];
    onProgress?.({ phase: 'resolve', current: i, total, detail: follow.name });

    const resolved = await resolveSeries(tmdb, follow);
    if (!resolved) {
      unresolved.push({ name: follow.name, tvdbId: follow.tvdbId });
      continue;
    }

    tvdbToTmdb.set(follow.tvdbId, resolved.id);
    nameToTmdb.set(normalizeSeriesName(follow.name), resolved.id);

    onProgress?.({ phase: 'sync', current: i, total, detail: follow.name });
    try {
      await syncSeriesFull(db, apiKey, resolved.id, { follow: true, language });
      synced++;
      /* If archived on TV Time, restore the original follow date and
       * mark as removed so the show stays out of "To watch" but
       * keeps its history. */
      if (follow.archived) {
        await setSeriesFollowDates(db, resolved.id, {
          addedAt: follow.followedAt ?? new Date(),
          removedAt: new Date()
        });
      } else if (follow.followedAt) {
        await setSeriesFollowDates(db, resolved.id, { addedAt: follow.followedAt });
      }
    } catch (err) {
      /* TMDB match succeeded but the subsequent sync threw (TMDB 5xx,
       * schema mismatch, network blip). Keep the nameToTmdb mapping
       * so phase 2 still has a target — it'll simply skip individual
       * watches if no local episode rows exist for them. The user
       * can re-sync the affected series later from the normal flow.
       *
       * We log the underlying error so a developer reading server
       * logs (or the browser console for local builds) can tell
       * apart a rate-limit storm from a one-off schema mismatch.
       * The UI still surfaces the failure via `syncFailed[]`. */
      console.warn(`[tvtime-import] sync failed for "${follow.name}" (TMDB ${resolved.id}):`, err);
      syncFailed.push({ name: follow.name, tvdbId: follow.tvdbId, tmdbId: resolved.id });
    }
  }

  onProgress?.({ phase: 'resolve', current: total, total });

  return {
    tvdbToTmdb,
    nameToTmdb,
    seriesMatched: tvdbToTmdb.size,
    seriesSynced: synced,
    syncFailed,
    unresolved
  };
}

/**
 * Resolve a TV Time follow row to a TMDB series.
 *
 * Strategy:
 *  1. `/find/{tvdb_id}?external_source=tvdb_id` — the happy path. TV
 *     Time's `tv_show_id` IS a TheTVDB id, so this nails an exact
 *     match almost every time.
 *  2. If /find returns nothing (legacy show TheTVDB never linked to
 *     TMDB), fall back to `searchTv(name)` BUT only accept the result
 *     if its name (after normalization) matches the original. Without
 *     this guard, ambiguous titles ("The Office" US/UK, "Shameless"
 *     US/UK, "Wallander" BBC/SVT) would silently match the most
 *     popular variant and we'd import the wrong show.
 */
async function resolveSeries(
  tmdb: ReturnType<typeof createTmdbClient>,
  follow: TvTimeFollow
): Promise<TmdbSearchResult | null> {
  try {
    const hit = await tmdb.findByExternalId(follow.tvdbId, 'tvdb_id');
    if (hit) return hit;
  } catch (err) {
    /* /find can 404 or 5xx — fall through to title search.
     * Re-throw on auth/quota errors so the caller can fail fast instead
     * of silently treating every series as "unresolved". */
    if (err instanceof TmdbError && (err.status === 401 || err.status === 403 || err.status === 429)) {
      throw err;
    }
    console.warn(`[tvtime-import] /find failed for "${follow.name}" (tvdb ${follow.tvdbId}):`, err);
  }

  try {
    const search = await tmdb.searchTv(follow.name);
    const target = normalizeSeriesName(follow.name);
    const match = search.results.find(
      (r) =>
        normalizeSeriesName(r.name) === target ||
        normalizeSeriesName(r.original_name ?? '') === target
    );
    return match ?? null;
  } catch (err) {
    if (err instanceof TmdbError && (err.status === 401 || err.status === 403 || err.status === 429)) {
      throw err;
    }
    console.warn(`[tvtime-import] search failed for "${follow.name}":`, err);
    return null;
  }
}

/**
 * Phase 2 — walk the watch history and mark each (series, S, E) as
 * watched in the local DB. Series that didn't resolve in phase 1 are
 * skipped (no matching tmdbId). Episodes that don't exist in the
 * local DB are skipped (e.g. the user watched something TV Time had
 * but TMDB doesn't expose) — counted as `watchesSkipped`.
 *
 * Reports progress every 50 entries to avoid flooding the callback.
 */
export async function importPhase2(
  db: Db,
  parsed: ParsedExport,
  nameToTmdb: Map<string, number>,
  onProgress?: ProgressCallback
): Promise<Phase2Summary> {
  let applied = 0;
  let skipped = 0;
  const watches = parsed.history.watches;
  const total = watches.length;
  onProgress?.({ phase: 'mark', current: 0, total });

  for (let i = 0; i < total; i++) {
    const w = watches[i];
    /* Look up by the normalized series name. The map was populated
     * with normalized keys in phase 1; this covers TV Time's
     * inter-file inconsistencies (curly vs straight apostrophes,
     * "Marvel's …" prefixes, casing differences). */
    const tmdbId = nameToTmdb.get(normalizeSeriesName(w.seriesName));
    if (tmdbId === undefined) {
      skipped++;
      continue;
    }
    const ep = await getEpisodeForCoords(db, tmdbId, w.seasonNumber, w.episodeNumber);
    if (ep === null) {
      skipped++;
      continue;
    }
    /* watchedAt fallback chain:
     *   1. the source row's created_at (the user's actual watch time);
     *   2. the episode's air_date — better than `now` since it places
     *      the mark on a plausible date instead of polluting today's
     *      timeline with imported history;
     *   3. as a last resort, today.
     */
    const at = w.watchedAt ?? (ep.airDate ? new Date(ep.airDate) : new Date());
    await markEpisodeWatched(db, ep.id, at);
    applied++;
    /* Throttle progress emissions — every row would flood the
     * callback and (in server mode) burn settings writes. */
    if (i > 0 && i % 50 === 0) {
      onProgress?.({ phase: 'mark', current: i, total });
    }
  }
  onProgress?.({ phase: 'mark', current: total, total });
  onProgress?.({ phase: 'done', current: total, total });

  return { watchesApplied: applied, watchesSkipped: skipped };
}

export type ImportSummary = Phase1Summary & Phase2Summary & { parsed: ParsedExport };

/**
 * Convenience wrapper: parse + phase 1 + phase 2 sequentially.
 *
 * Callers that want to surface phase-1 results before phase 2 finishes
 * (the "use the app while history fills in" UX) should call the
 * individual phases instead and persist `nameToTmdb` between them.
 */
export async function runImport(
  db: Db,
  apiKey: string,
  language: string,
  file: Blob,
  password: string,
  onProgress?: ProgressCallback
): Promise<ImportSummary> {
  const parsed = await parseTvTimeExport(file, password, onProgress);
  const p1 = await importPhase1(db, apiKey, language, parsed, onProgress);
  const p2 = await importPhase2(db, parsed, p1.nameToTmdb, onProgress);
  return { ...p1, ...p2, parsed };
}
