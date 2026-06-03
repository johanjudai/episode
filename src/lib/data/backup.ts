/**
 * Portable export/import of the user's local data as a single, versioned
 * JSON document. Works against any `Db` (better-sqlite3 on the server,
 * sql.js in the browser) — same surface as queries/mutations.
 *
 * Why a JSON snapshot and not a raw SQLite blob:
 *  - readable and diffable
 *  - decoupled from autoincrement IDs: `watched` is exported by
 *    (seriesTmdbId, seasonNumber, episodeNumber), so a backup taken on
 *    instance A can be restored on instance B where the same episode row
 *    has a different `id`
 *  - leaves room for schema migrations: parseBackup currently rejects any
 *    version != BACKUP_VERSION, but the bump-and-write-a-migrator path is
 *    open the day we need it
 *
 * Secrets (TMDB/OMDb keys) are stripped from `settings` unless the caller
 * explicitly opts in.
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from './db-types';
import { episodes, seasons, series, settings, watched } from './schema';

export const BACKUP_FORMAT = 'episode-backup' as const;
export const BACKUP_VERSION = 1 as const;

const SECRET_KEYS = new Set(['tmdb.api_key', 'omdb.api_key']);

/* Per-string cap for backup-imported settings values. Without it, a
 * forged backup with a single multi-MB settings row would be written
 * verbatim to the SQLite file (text columns are uncapped at the
 * schema level). 256 KB comfortably fits every value Episode actually
 * writes — the largest legitimate row is the avatar data URL (capped
 * separately to MAX_AVATAR_LENGTH ≈ 200 KB in profile/avatar). */
const MAX_SETTING_VALUE_BYTES = 256 * 1024;
/* Cap individual text fields on user-supplied rows. TMDB itself caps
 * overviews to a few thousand chars but a forged backup is unbounded.
 * 32 KB is more than any plausible legitimate value. */
const MAX_TEXT_FIELD_BYTES = 32 * 1024;
const MAX_NAME_BYTES = 1024;

const SettingRow = z.object({
  key: z.string().max(256),
  value: z.string().max(MAX_SETTING_VALUE_BYTES).nullable(),
  updatedAt: z.number().int().nullable().optional()
});

const SeriesRow = z.object({
  tmdbId: z.number().int(),
  name: z.string().max(MAX_NAME_BYTES),
  originalName: z.string().max(MAX_NAME_BYTES).nullable().optional(),
  overview: z.string().max(MAX_TEXT_FIELD_BYTES).nullable().optional(),
  posterPath: z.string().max(MAX_NAME_BYTES).nullable().optional(),
  backdropPath: z.string().max(MAX_NAME_BYTES).nullable().optional(),
  firstAirDate: z.string().max(64).nullable().optional(),
  lastAirDate: z.string().max(64).nullable().optional(),
  status: z.string().max(64).nullable().optional(),
  network: z.string().max(MAX_NAME_BYTES).nullable().optional(),
  numberOfSeasons: z.number().int().nullable().optional(),
  numberOfEpisodes: z.number().int().nullable().optional(),
  runtimeMinutes: z.number().int().nullable().optional(),
  isAnime: z.boolean().nullable().optional(),
  addedAt: z.number().int().nullable().optional(),
  removedAt: z.number().int().nullable().optional(),
  lastSyncedAt: z.number().int().nullable().optional()
});

const SeasonRow = z.object({
  seriesTmdbId: z.number().int(),
  seasonNumber: z.number().int(),
  tmdbId: z.number().int().nullable().optional(),
  name: z.string().max(MAX_NAME_BYTES).nullable().optional(),
  overview: z.string().max(MAX_TEXT_FIELD_BYTES).nullable().optional(),
  airDate: z.string().max(64).nullable().optional(),
  episodeCount: z.number().int().nullable().optional(),
  posterPath: z.string().max(MAX_NAME_BYTES).nullable().optional()
});

const EpisodeRow = z.object({
  seriesTmdbId: z.number().int(),
  seasonNumber: z.number().int(),
  episodeNumber: z.number().int(),
  tmdbId: z.number().int().nullable().optional(),
  name: z.string().max(MAX_NAME_BYTES).nullable().optional(),
  overview: z.string().max(MAX_TEXT_FIELD_BYTES).nullable().optional(),
  airDate: z.string().max(64).nullable().optional(),
  runtimeMinutes: z.number().int().nullable().optional(),
  stillPath: z.string().max(MAX_NAME_BYTES).nullable().optional()
});

const WatchedRow = z.object({
  seriesTmdbId: z.number().int(),
  seasonNumber: z.number().int(),
  episodeNumber: z.number().int(),
  watchedAt: z.number().int()
});

export const BackupV1 = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(1),
  exportedAt: z.string(),
  appVersion: z.string().optional(),
  settings: z.array(SettingRow),
  series: z.array(SeriesRow),
  seasons: z.array(SeasonRow),
  episodes: z.array(EpisodeRow),
  watched: z.array(WatchedRow)
});

export type Backup = z.infer<typeof BackupV1>;

export class BackupImportError extends Error {
  constructor(
    message: string,
    public cause?: unknown
  ) {
    super(message);
    this.name = 'BackupImportError';
  }
}

export interface ExportOptions {
  /** Include secret settings (API keys). Default: false. */
  includeSecrets?: boolean;
  /** Override appVersion stamp (otherwise omitted). */
  appVersion?: string;
}

export async function exportBackup(db: Db, opts: ExportOptions = {}): Promise<Backup> {
  const settingRows = db.select().from(settings).all();
  const seriesRows = db.select().from(series).all();
  const seasonRows = db.select().from(seasons).all();
  const episodeRows = db.select().from(episodes).all();
  const watchedRows = db
    .select({
      seriesTmdbId: episodes.seriesTmdbId,
      seasonNumber: episodes.seasonNumber,
      episodeNumber: episodes.episodeNumber,
      watchedAt: watched.watchedAt
    })
    .from(watched)
    .innerJoin(episodes, eq(episodes.id, watched.episodeId))
    .all();

  const includeSecrets = !!opts.includeSecrets;

  const out: Backup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    ...(opts.appVersion ? { appVersion: opts.appVersion } : {}),
    settings: settingRows
      .filter((r) => includeSecrets || !SECRET_KEYS.has(r.key))
      .map((r) => ({
        key: r.key,
        value: r.value,
        updatedAt: r.updatedAt ? r.updatedAt.getTime() : null
      })),
    series: seriesRows.map((r) => ({
      tmdbId: r.tmdbId,
      name: r.name,
      originalName: r.originalName,
      overview: r.overview,
      posterPath: r.posterPath,
      backdropPath: r.backdropPath,
      firstAirDate: r.firstAirDate,
      lastAirDate: r.lastAirDate,
      status: r.status,
      network: r.network,
      numberOfSeasons: r.numberOfSeasons,
      numberOfEpisodes: r.numberOfEpisodes,
      runtimeMinutes: r.runtimeMinutes,
      isAnime: r.isAnime,
      addedAt: r.addedAt ? r.addedAt.getTime() : null,
      removedAt: r.removedAt ? r.removedAt.getTime() : null,
      lastSyncedAt: r.lastSyncedAt ? r.lastSyncedAt.getTime() : null
    })),
    seasons: seasonRows.map((r) => ({
      seriesTmdbId: r.seriesTmdbId,
      seasonNumber: r.seasonNumber,
      tmdbId: r.tmdbId,
      name: r.name,
      overview: r.overview,
      airDate: r.airDate,
      episodeCount: r.episodeCount,
      posterPath: r.posterPath
    })),
    episodes: episodeRows.map((r) => ({
      seriesTmdbId: r.seriesTmdbId,
      seasonNumber: r.seasonNumber,
      episodeNumber: r.episodeNumber,
      tmdbId: r.tmdbId,
      name: r.name,
      overview: r.overview,
      airDate: r.airDate,
      runtimeMinutes: r.runtimeMinutes,
      stillPath: r.stillPath
    })),
    watched: watchedRows.map((r) => ({
      seriesTmdbId: r.seriesTmdbId,
      seasonNumber: r.seasonNumber,
      episodeNumber: r.episodeNumber,
      watchedAt: r.watchedAt.getTime()
    }))
  };

  return out;
}

export interface ImportOptions {
  /**
   * - `merge` (default): upsert everything, keep existing rows not present
   *   in the backup. Existing `watched` rows survive. Columns absent
   *   from the backup row keep their current local value (no silent
   *   overwrite by null).
   * - `replace`: wipe `watched`, `episodes`, `seasons`, `series` and
   *   `settings` before applying. The user's API keys are preserved
   *   across the wipe (re-injected after settings are emptied) unless
   *   `includeSecrets` is set and the backup carries them.
   */
  mode?: 'merge' | 'replace';
  /** Allow secret settings to be imported from the backup. Default: false. */
  includeSecrets?: boolean;
}

export interface ImportResult {
  counts: {
    settings: number;
    series: number;
    seasons: number;
    episodes: number;
    watched: number;
  };
}

export function parseBackup(raw: string): Backup {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new BackupImportError('Fichier JSON invalide', err);
  }
  if (!data || typeof data !== 'object') {
    throw new BackupImportError('Format inattendu : objet JSON requis');
  }
  const obj = data as Record<string, unknown>;
  if (obj.format !== BACKUP_FORMAT) {
    throw new BackupImportError(
      `Format inconnu : "${String(obj.format)}" (attendu "${BACKUP_FORMAT}")`
    );
  }
  if (obj.version !== BACKUP_VERSION) {
    throw new BackupImportError(
      `Version de sauvegarde non supportée : ${String(obj.version)}`
    );
  }
  const parsed = BackupV1.safeParse(data);
  if (!parsed.success) {
    throw new BackupImportError('Structure de sauvegarde invalide', parsed.error);
  }
  return parsed.data;
}

/* Mid-import helper: capture API keys before a `replace` wipe so the
 * user doesn't lose them if the backup didn't carry secrets. */
function captureSecrets(db: Db): Array<{ key: string; value: string | null; updatedAt: Date | null }> {
  const out: Array<{ key: string; value: string | null; updatedAt: Date | null }> = [];
  for (const k of SECRET_KEYS) {
    const row = db.select().from(settings).where(eq(settings.key, k)).all()[0];
    if (row) out.push({ key: row.key, value: row.value, updatedAt: row.updatedAt ?? null });
  }
  return out;
}

export async function importBackup(
  db: Db,
  backup: Backup,
  opts: ImportOptions = {}
): Promise<ImportResult> {
  const mode = opts.mode ?? 'merge';
  const includeSecrets = !!opts.includeSecrets;

  /* Capture API keys before the wipe — replace mode would otherwise nuke
   * them silently when the backup doesn't carry secrets. */
  const preservedSecrets = mode === 'replace' && !includeSecrets ? captureSecrets(db) : [];

  /* The whole import runs in a single SQLite transaction. Any thrown
   * error rolls back, leaving the user's data exactly as it was before
   * the click. better-sqlite3 and sql.js both honor BEGIN/COMMIT/ROLLBACK
   * the same way; drizzle's sync `db.transaction(cb)` wraps that.
   *
   * Important: the callback is *synchronous*. None of the inline SQL
   * below uses `await` — every drizzle `.run()` executes immediately,
   * so a throw mid-callback rolls back the partial write set. */
  return db.transaction((tx) => {
    if (mode === 'replace') {
      tx.delete(watched).run();
      tx.delete(episodes).run();
      tx.delete(seasons).run();
      tx.delete(series).run();
      tx.delete(settings).run();
    }

    /* Settings — preserve `updatedAt` from the backup row instead of
     * stamping `now` (setSetting() would do the latter). */
    let settingsCount = 0;
    for (const s of backup.settings) {
      if (!includeSecrets && SECRET_KEYS.has(s.key)) continue;
      const updatedAt = s.updatedAt != null ? new Date(s.updatedAt) : new Date();
      tx.insert(settings)
        .values({ key: s.key, value: s.value, updatedAt })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value: s.value, updatedAt }
        })
        .run();
      settingsCount++;
    }

    /* Re-inject preserved secrets last so they survive a `replace`
     * wipe. They don't count toward `settingsCount` (which reports
     * what the *backup* contributed). */
    for (const s of preservedSecrets) {
      tx.insert(settings)
        .values({ key: s.key, value: s.value, updatedAt: s.updatedAt ?? new Date() })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value: s.value, updatedAt: s.updatedAt ?? new Date() }
        })
        .run();
    }

    /* Series — direct upsert that preserves *all* backup columns and
     * leaves columns absent from the backup untouched on existing rows
     * (merge mode contract). `tmdbId` is the natural key. */
    for (const s of backup.series) {
      const insertValues: Record<string, unknown> = {
        tmdbId: s.tmdbId,
        name: s.name
      };
      const updateSet: Record<string, unknown> = { name: s.name };

      const copyDefined = (
        field: keyof typeof s,
        column: string,
        map?: (v: unknown) => unknown
      ) => {
        if (s[field] === undefined) return;
        const v = map ? map(s[field]) : s[field];
        insertValues[column] = v;
        updateSet[column] = v;
      };
      copyDefined('originalName', 'originalName');
      copyDefined('overview', 'overview');
      copyDefined('posterPath', 'posterPath');
      copyDefined('backdropPath', 'backdropPath');
      copyDefined('firstAirDate', 'firstAirDate');
      copyDefined('lastAirDate', 'lastAirDate');
      copyDefined('status', 'status');
      copyDefined('network', 'network');
      copyDefined('numberOfSeasons', 'numberOfSeasons');
      copyDefined('numberOfEpisodes', 'numberOfEpisodes');
      copyDefined('runtimeMinutes', 'runtimeMinutes');
      copyDefined('isAnime', 'isAnime');
      copyDefined('addedAt', 'addedAt', (v) => (v == null ? null : new Date(v as number)));
      copyDefined('removedAt', 'removedAt', (v) => (v == null ? null : new Date(v as number)));
      copyDefined('lastSyncedAt', 'lastSyncedAt', (v) =>
        v == null ? null : new Date(v as number)
      );

      tx.insert(series)
        .values(insertValues as typeof series.$inferInsert)
        .onConflictDoUpdate({ target: series.tmdbId, set: updateSet })
        .run();
    }

    /* Seasons — same shape: only touch columns the backup carries. */
    for (const s of backup.seasons) {
      const insertValues: Record<string, unknown> = {
        seriesTmdbId: s.seriesTmdbId,
        seasonNumber: s.seasonNumber
      };
      const updateSet: Record<string, unknown> = {};
      const copyDefined = (field: keyof typeof s, column: string) => {
        if (s[field] === undefined) return;
        insertValues[column] = s[field];
        updateSet[column] = s[field];
      };
      copyDefined('tmdbId', 'tmdbId');
      copyDefined('name', 'name');
      copyDefined('overview', 'overview');
      copyDefined('airDate', 'airDate');
      copyDefined('episodeCount', 'episodeCount');
      copyDefined('posterPath', 'posterPath');

      tx.insert(seasons)
        .values(insertValues as typeof seasons.$inferInsert)
        .onConflictDoUpdate({
          target: [seasons.seriesTmdbId, seasons.seasonNumber],
          set: updateSet
        })
        .run();
    }

    /* Build (seriesTmdbId, seasonNumber) → seasonId map once, instead
     * of a SELECT per episode. The backup-side dataset can include
     * thousands of episode rows. */
    const seasonIdBy = new Map<string, number>();
    for (const row of tx.select().from(seasons).all()) {
      seasonIdBy.set(`${row.seriesTmdbId}:${row.seasonNumber}`, row.id);
    }

    for (const e of backup.episodes) {
      const seasonId = seasonIdBy.get(`${e.seriesTmdbId}:${e.seasonNumber}`);
      if (seasonId === undefined) continue;
      const insertValues: Record<string, unknown> = {
        seasonId,
        seriesTmdbId: e.seriesTmdbId,
        seasonNumber: e.seasonNumber,
        episodeNumber: e.episodeNumber
      };
      const updateSet: Record<string, unknown> = {};
      const copyDefined = (field: keyof typeof e, column: string) => {
        if (e[field] === undefined) return;
        insertValues[column] = e[field];
        updateSet[column] = e[field];
      };
      copyDefined('tmdbId', 'tmdbId');
      copyDefined('name', 'name');
      copyDefined('overview', 'overview');
      copyDefined('airDate', 'airDate');
      copyDefined('runtimeMinutes', 'runtimeMinutes');
      copyDefined('stillPath', 'stillPath');

      tx.insert(episodes)
        .values(insertValues as typeof episodes.$inferInsert)
        .onConflictDoUpdate({
          target: [episodes.seriesTmdbId, episodes.seasonNumber, episodes.episodeNumber],
          set: updateSet
        })
        .run();
    }

    /* Watched — resolve episode_id via the coords map, skip ghosts. */
    const episodeIdBy = new Map<string, number>();
    for (const row of tx.select().from(episodes).all()) {
      episodeIdBy.set(
        `${row.seriesTmdbId}:${row.seasonNumber}:${row.episodeNumber}`,
        row.id
      );
    }

    let watchedCount = 0;
    for (const w of backup.watched) {
      const epId = episodeIdBy.get(
        `${w.seriesTmdbId}:${w.seasonNumber}:${w.episodeNumber}`
      );
      if (epId === undefined) continue;
      tx.insert(watched)
        .values({ episodeId: epId, watchedAt: new Date(w.watchedAt) })
        .onConflictDoNothing({ target: watched.episodeId })
        .run();
      watchedCount++;
    }

    return {
      counts: {
        settings: settingsCount,
        series: backup.series.length,
        seasons: backup.seasons.length,
        episodes: backup.episodes.length,
        watched: watchedCount
      }
    };
  });
}
