/**
 * Unified mutation API — called from Svelte components in BOTH targets.
 *
 *  - In **server target** builds, each call POSTs JSON to a `/api/*`
 *    endpoint, which runs the mutation against the Node driver.
 *  - In **local target** builds, each call runs the mutation directly
 *    in the browser against the sql.js driver.
 *
 * The branching is a build-time Vite define (`__EPISODE_TARGET__`), so the
 * unused branch is dead-code-eliminated from each bundle.
 *
 * After every successful mutation the caller is responsible for calling
 * `invalidateAll()` (server target — same as today) or letting the page
 * `$state` refresh reactively (local target).
 */
import { IS_LOCAL } from './config';

async function postJson(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res.json().catch(() => ({}));
}

async function withLocalDb<T>(fn: (db: import('./data/db-types').Db) => Promise<T>): Promise<T> {
  const { getDb } = await import('./db');
  const db = await getDb();
  return fn(db);
}

/**
 * Suspend the per-mutation IndexedDB snapshot during a bulk flow.
 * Without this, an import or "mark all" issues one full sql.js export
 * per row — tens of MB written N times for a long history.
 *
 * No-op (just runs fn) on the server target, where there's no
 * IndexedDB layer at all. The dual-target Vite plugin won't strip the
 * import path, but the body is cheap.
 */
async function withBulkLocalWrites<T>(fn: () => Promise<T>): Promise<T> {
  if (!IS_LOCAL) return fn();
  const { withBulkWrites } = await import('./db.browser');
  return withBulkWrites(fn);
}

export interface FollowSeriesPayload {
  tmdbId: number;
  apiKey: string;
}

/** Mark a single episode watched (idempotent). */
export async function markEpisodeWatched(episodeId: number): Promise<void> {
  if (IS_LOCAL) {
    await withLocalDb(async (db) => {
      const m = await import('./data/mutations');
      await m.markEpisodeWatched(db, episodeId);
    });
    return;
  }
  await postJson('/api/episodes/mark', { episodeId });
}

export async function unmarkEpisodeWatched(episodeId: number): Promise<void> {
  if (IS_LOCAL) {
    await withLocalDb(async (db) => {
      const m = await import('./data/mutations');
      await m.unmarkEpisodeWatched(db, episodeId);
    });
    return;
  }
  await postJson('/api/episodes/unmark', { episodeId });
}

/** Follow / unfollow series. Follow needs TMDB metadata — we look it up in API mode. */
export async function unfollowSeries(seriesTmdbId: number): Promise<void> {
  if (IS_LOCAL) {
    await withLocalDb(async (db) => {
      const m = await import('./data/mutations');
      await m.unfollowSeries(db, seriesTmdbId);
    });
    return;
  }
  await postJson('/api/series/unfollow', { seriesTmdbId });
}

export interface SeriesMutationArgs {
  seriesTmdbId: number;
  seasonNumber: number;
  episodeNumber: number;
  watched: boolean;
  markPrevious?: boolean;
}

export async function markEpisodeForSeries(args: SeriesMutationArgs): Promise<void> {
  if (IS_LOCAL) {
    const { syncEpisodeRow, syncSeriesFull } = await import('./local-sync');
    /* Mirror the server endpoint: auto-follow if the series row is missing or
     * was previously unfollowed. Without this, the first mark on a brand-new
     * series page produces orphan rows that the followed-series queries hide. */
    await withLocalDb(async (db) => {
      const q = await import('./data/queries');
      const existing = await q.getSeries(db, args.seriesTmdbId);
      if (!existing || existing.removedAt) {
        await syncSeriesFull(args.seriesTmdbId, { follow: true });
      }
    });
    await syncEpisodeRow(args.seriesTmdbId, args.seasonNumber, args.episodeNumber);
    await withLocalDb(async (db) => {
      const m = await import('./data/mutations');
      const epId = await m.getEpisodeIdByCoords(
        db,
        args.seriesTmdbId,
        args.seasonNumber,
        args.episodeNumber
      );
      if (epId === null) throw new Error('Épisode introuvable après synchronisation');
      if (args.watched) {
        if (args.markPrevious) {
          await m.markEpisodesUpTo(db, args.seriesTmdbId, args.seasonNumber, args.episodeNumber);
        } else {
          await m.markEpisodeWatched(db, epId);
        }
      } else {
        await m.unmarkEpisodeWatched(db, epId);
      }
    });
    return;
  }
  await postJson('/api/series/mark-episode', args);
}

export interface SeasonMutationArgs {
  seriesTmdbId: number;
  seasonNumber: number;
  watched: boolean;
  markPrevious?: boolean;
}

export async function markSeasonForSeries(args: SeasonMutationArgs): Promise<void> {
  if (IS_LOCAL) {
    const { syncSeasonRow, syncSeriesFull } = await import('./local-sync');
    if (args.watched) {
      await withLocalDb(async (db) => {
        const q = await import('./data/queries');
        const existing = await q.getSeries(db, args.seriesTmdbId);
        if (!existing || existing.removedAt) {
          await syncSeriesFull(args.seriesTmdbId, { follow: true });
        }
      });
      await syncSeasonRow(args.seriesTmdbId, args.seasonNumber);
    }
    await withLocalDb(async (db) => {
      const m = await import('./data/mutations');
      if (!args.watched) {
        await m.unmarkSeasonWatched(db, args.seriesTmdbId, args.seasonNumber);
        return;
      }
      if (args.markPrevious) {
        await m.markSeasonsUpTo(db, args.seriesTmdbId, args.seasonNumber);
      } else {
        await m.markSeasonWatched(db, args.seriesTmdbId, args.seasonNumber);
      }
    });
    return;
  }
  await postJson('/api/series/mark-season', args);
}

export async function followSeries(seriesTmdbId: number): Promise<void> {
  if (IS_LOCAL) {
    const { syncSeriesFull } = await import('./local-sync');
    await syncSeriesFull(seriesTmdbId, { follow: true });
    return;
  }
  await postJson('/api/series/follow', { seriesTmdbId });
}

export async function markAllForSeries(seriesTmdbId: number): Promise<void> {
  if (IS_LOCAL) {
    await withBulkLocalWrites(async () => {
      const { syncSeriesFull } = await import('./local-sync');
      await syncSeriesFull(seriesTmdbId, { follow: true });
      await withLocalDb(async (db) => {
        const m = await import('./data/mutations');
        await m.markSeriesWatched(db, seriesTmdbId);
      });
    });
    return;
  }
  await postJson('/api/series/mark-all', { seriesTmdbId });
}

/** Profile / settings — also called from the server-mode form actions today, but
 *  the local target needs the same surface for the settings page. */
export async function updateProfileName(name: string): Promise<void> {
  if (IS_LOCAL) {
    await withLocalDb(async (db) => {
      const m = await import('./data/mutations');
      await m.setSetting(db, 'profile.name', name);
    });
    return;
  }
  await postJson('/api/profile/name', { name });
}

export async function updateAvatar(avatar: string): Promise<void> {
  if (IS_LOCAL) {
    await withLocalDb(async (db) => {
      const m = await import('./data/mutations');
      await m.setSetting(db, 'profile.avatar', avatar || null);
    });
    return;
  }
  await postJson('/api/profile/avatar', { avatar });
}

export async function updateTmdbKey(apiKey: string): Promise<void> {
  if (IS_LOCAL) {
    /* Validate the key client-side by calling /trending/tv/week. */
    const { createTmdbClient } = await import('./data/tmdb');
    const client = createTmdbClient({ apiKey });
    await client.trendingTv('week');
    await withLocalDb(async (db) => {
      const m = await import('./data/mutations');
      await m.setSetting(db, 'tmdb.api_key', apiKey);
    });
    return;
  }
  await postJson('/api/settings/tmdb-key', { apiKey });
}

export async function updateOmdbKey(apiKey: string): Promise<void> {
  if (IS_LOCAL) {
    const { createOmdbClient } = await import('./data/omdb');
    const client = createOmdbClient({ apiKey });
    const resp = await client.byImdbId('tt1190634');
    if (resp.Response !== 'True') {
      throw new Error('OMDb : clé rejetée');
    }
    await withLocalDb(async (db) => {
      const m = await import('./data/mutations');
      await m.setSetting(db, 'omdb.api_key', apiKey);
    });
    return;
  }
  await postJson('/api/settings/omdb-key', { apiKey });
}

export async function updateLocale(locale: 'fr' | 'en'): Promise<void> {
  if (IS_LOCAL) {
    await withLocalDb(async (db) => {
      const m = await import('./data/mutations');
      await m.setSetting(db, 'locale', locale);
    });
    return;
  }
  await postJson('/api/settings/locale', { locale });
}

/**
 * Refresh every followed series' TMDB-cached strings (titles, season
 * names, episode names, overviews) with the current locale. Called by
 * the settings page after a locale switch so series and episode names
 * actually swap from FR to EN (or vice-versa) instead of staying in
 * whatever language was active at sync time.
 *
 * Returns the count of series re-synced so the UI can confirm the
 * operation. Failures per series are silent — the next visit on the
 * affected series will retry transparently.
 */
export async function resyncAllForLocale(): Promise<{ count: number }> {
  if (IS_LOCAL) {
    const { resyncAllForLocale: localResync } = await import('./local-sync');
    return localResync();
  }
  const body = (await postJson('/api/resync-all', {})) as { count: number };
  return body;
}

export async function completeOnboarding(name: string, avatar: string): Promise<void> {
  if (IS_LOCAL) {
    await withLocalDb(async (db) => {
      const m = await import('./data/mutations');
      await m.setSetting(db, 'profile.name', name);
      if (avatar) await m.setSetting(db, 'profile.avatar', avatar);
      await m.setSetting(db, 'onboarding.completed_at', new Date().toISOString());
    });
    return;
  }
  await postJson('/api/onboarding/complete', { name, avatar });
}

/**
 * Export all local data as a versioned JSON Backup document. Server
 * target hits /api/backup/export; local target reads from sql.js. API
 * keys are excluded unless `includeSecrets` is set.
 */
export async function exportLocalData(
  opts: { includeSecrets?: boolean } = {}
): Promise<import('./data/backup').Backup> {
  if (IS_LOCAL) {
    return withLocalDb(async (db) => {
      const m = await import('./data/backup');
      return m.exportBackup(db, { includeSecrets: opts.includeSecrets });
    });
  }
  const url = `/api/backup/export${opts.includeSecrets ? '?secrets=1' : ''}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Export failed: ${res.status}`);
  }
  return (await res.json()) as import('./data/backup').Backup;
}

export interface ImportLocalDataOptions {
  mode?: 'merge' | 'replace';
  includeSecrets?: boolean;
}

/**
 * Import a previously exported JSON Backup. Validates the file, then
 * applies it through the same surface the rest of the app writes
 * through. Returns row counts so the UI can confirm.
 */
export async function importLocalData(
  file: File,
  opts: ImportLocalDataOptions = {}
): Promise<import('./data/backup').ImportResult> {
  if (IS_LOCAL) {
    const text = await file.text();
    const { parseBackup, importBackup } = await import('./data/backup');
    const backup = parseBackup(text);
    return withBulkLocalWrites(() => withLocalDb((db) => importBackup(db, backup, opts)));
  }
  const fd = new FormData();
  fd.set('file', file);
  if (opts.mode) fd.set('mode', opts.mode);
  if (opts.includeSecrets) fd.set('secrets', '1');
  const res = await fetch('/api/backup/import', { method: 'POST', body: fd });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Import failed: ${res.status}`);
  }
  return (await res.json()) as import('./data/backup').ImportResult;
}

/**
 * Typed error thrown by `importTvTime` so the UI can render a
 * localized message via i18n instead of leaking a hardcoded server
 * string. Codes are stable across server / local target.
 */
export type ImportErrorCode =
  | 'FILE_TOO_LARGE'
  | 'FILE_REQUIRED'
  | 'PASSWORD_REQUIRED'
  | 'TMDB_KEY_MISSING'
  | 'BAD_PASSWORD'
  | 'INVALID_ZIP'
  | 'MISSING_FOLLOWED_CSV'
  | 'CONCURRENT_IMPORT'
  | 'INTERNAL';

export class ImportError extends Error {
  constructor(
    public code: ImportErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'ImportError';
  }
}

export interface TvTimeImportSummary {
  /** Series matched on TMDB (including ones whose subsequent sync failed). */
  seriesMatched: number;
  /** Series whose episodes were successfully synced into the local DB. */
  seriesSynced: number;
  /** Matched on TMDB but the sync threw — name mapping kept, but local
   *  episodes are missing so phase 2 will skip watches for these. */
  syncFailed: { name: string; tvdbId: number; tmdbId: number }[];
  /** Couldn't even match on TMDB. */
  unresolved: { name: string; tvdbId: number }[];
  watchesApplied: number;
  watchesSkipped: number;
}

export type TvTimeImportProgress = import('./data/tvtime-pipeline').ImportProgress;

/**
 * Upload a TV Time GDPR ZIP (password-protected) and run the full
 * import — decrypt, resolve TheTVDB→TMDB, sync series, mark watched
 * episodes. Reports progress through `onProgress` so the UI can show
 * which phase we're in (parse → resolve → sync → mark → done).
 *
 * Server target: multiparts the file to /api/import/tvtime; the server
 * runs everything and the client polls the same endpoint (GET) for
 * progress in parallel. We resolve once the POST returns the final
 * summary — progress polling is purely for UI feedback.
 *
 * Local target: runs the whole pipeline in the browser against the
 * sql.js DB. No upload, no server hop.
 */
export async function importTvTime(
  file: File,
  password: string,
  onProgress?: (p: TvTimeImportProgress) => void
): Promise<TvTimeImportSummary> {
  if (IS_LOCAL) {
    const { runImport, TvTimeZipError, TvTimeImportError } = await import('./data/tvtime-pipeline');
    const { readApiKey, readLanguage } = await import('./local-sync');
    let apiKey: string;
    let language: string;
    try {
      [apiKey, language] = await Promise.all([readApiKey(), readLanguage()]);
    } catch (err) {
      /* readApiKey throws when the local DB has no TMDB key set —
       * surface as the typed error so the UI shows the right hint. */
      throw new ImportError(
        'TMDB_KEY_MISSING',
        err instanceof Error ? err.message : 'TMDB key missing'
      );
    }
    try {
      const summary = await withBulkLocalWrites(() =>
        withLocalDb((db) => runImport(db, apiKey, language, file, password, onProgress))
      );
      return {
        seriesMatched: summary.seriesMatched,
        seriesSynced: summary.seriesSynced,
        syncFailed: summary.syncFailed,
        unresolved: summary.unresolved,
        watchesApplied: summary.watchesApplied,
        watchesSkipped: summary.watchesSkipped
      };
    } catch (err) {
      if (err instanceof TvTimeZipError) {
        const code: ImportErrorCode = err.code === 'BAD_PASSWORD' ? 'BAD_PASSWORD' : 'INVALID_ZIP';
        throw new ImportError(code, err.message);
      }
      if (err instanceof TvTimeImportError) {
        const code: ImportErrorCode =
          err.code === 'MISSING_FOLLOWED_CSV' ? 'MISSING_FOLLOWED_CSV' : 'INVALID_ZIP';
        throw new ImportError(code, err.message);
      }
      throw err;
    }
  }

  /* Server target: kick off the POST, then poll GET in parallel for
   * progress so the UI can render counters while the slow phases
   * (resolve / sync / mark) run on the server. */
  const fd = new FormData();
  fd.set('file', file);
  fd.set('password', password);
  const post = fetch('/api/import/tvtime', { method: 'POST', body: fd });

  /* AbortController lets us interrupt the in-flight setTimeout the
   * moment the POST resolves, instead of waiting up to 1.5 s for the
   * next poll tick. Without it the "all set" overlay can lag visibly
   * behind the actual end of the import. */
  const pollAbort = new AbortController();
  function sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (signal.aborted) return resolve();
      const id = setTimeout(resolve, ms);
      signal.addEventListener('abort', () => {
        clearTimeout(id);
        resolve();
      });
    });
  }

  const poll = (async () => {
    /* First poll deferred a bit so that, if the POST fails fast on a
     * bad password, the user sees the error instead of a brief
     * "parsing ZIP" flash. */
    await sleep(600, pollAbort.signal);
    while (!pollAbort.signal.aborted) {
      try {
        const res = await fetch('/api/import/tvtime', {
          method: 'GET',
          signal: pollAbort.signal
        });
        if (res.ok) {
          const body = (await res.json()) as {
            progress: TvTimeImportProgress | null;
            running: boolean;
          };
          if (body.progress && body.running && onProgress) onProgress(body.progress);
        }
      } catch {
        /* ignore — POST is the source of truth (this also catches
         * the AbortError when the POST has resolved). */
      }
      await sleep(1500, pollAbort.signal);
    }
  })();

  try {
    const res = await post;
    if (!res.ok) {
      /* SvelteKit's `error(status, { message, code })` lands as a JSON
       * body `{ message, code }`. Extract both; fall back to a generic
       * code so the UI still picks SOMETHING translatable. */
      let code: ImportErrorCode = 'INTERNAL';
      let message = `Import failed: ${res.status}`;
      /* Whitelist of codes we accept from the server payload. A
       * malformed / forged response that carries an unknown string
       * would otherwise be passed through to importErrorKey, which
       * silently falls back to 'INTERNAL' but loses the source code
       * for diagnostics. */
      const KNOWN_CODES: ReadonlySet<ImportErrorCode> = new Set([
        'FILE_TOO_LARGE',
        'FILE_REQUIRED',
        'PASSWORD_REQUIRED',
        'TMDB_KEY_MISSING',
        'BAD_PASSWORD',
        'INVALID_ZIP',
        'MISSING_FOLLOWED_CSV',
        'CONCURRENT_IMPORT',
        'INTERNAL'
      ]);
      try {
        const body = (await res.json()) as { message?: string; code?: string };
        if (body?.code && KNOWN_CODES.has(body.code as ImportErrorCode)) {
          code = body.code as ImportErrorCode;
        }
        if (body?.message) message = body.message;
      } catch {
        /* non-JSON response (e.g. proxy 502 HTML page) — keep the generic. */
      }
      throw new ImportError(code, message);
    }
    return (await res.json()) as TvTimeImportSummary;
  } finally {
    pollAbort.abort();
    await poll;
  }
}
