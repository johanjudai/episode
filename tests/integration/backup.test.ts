/**
 * Backup round-trip suite. Like queries.test.ts, runs against BOTH the
 * better-sqlite3 (Node) and sql.js (WASM) drivers so the export/import
 * path is verified on both targets. Driver glue lives in `_drivers.ts`.
 *
 * Covered:
 *  - round-trip on the same driver: export → wipe → import → identical rows
 *  - cross-instance: export from DB A, import into a fresh DB B (proves
 *    `watched` is keyed by coords, not autoincrement episode_id)
 *  - skipSecrets: API keys are excluded from exports by default
 *  - replace mode wipes existing data first
 *  - version mismatch is rejected
 *  - malformed JSON is rejected
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { series, settings as settingsTable } from '../../src/lib/data/schema';
import { getRecentWatched, getSeries, getSetting } from '../../src/lib/data/queries';
import { followSeries, markEpisodeWatched, setSetting } from '../../src/lib/data/mutations';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  BackupImportError,
  exportBackup,
  importBackup,
  parseBackup
} from '../../src/lib/data/backup';
import { DUAL_DRIVERS, type DriverContext } from './_drivers';

function insertSeason(
  ctx: DriverContext,
  seriesTmdbId: number,
  seasonNumber: number,
  episodeCount: number
): number {
  ctx.raw.run(
    'INSERT INTO seasons (series_tmdb_id, season_number, episode_count) VALUES (?, ?, ?)',
    [seriesTmdbId, seasonNumber, episodeCount]
  );
  return ctx.raw.lastInsertId();
}

function setSeasonOverview(ctx: DriverContext, seasonId: number, overview: string): void {
  ctx.raw.run('UPDATE seasons SET overview = ? WHERE id = ?', [overview, seasonId]);
}

function insertEpisode(
  ctx: DriverContext,
  seasonId: number,
  seriesTmdbId: number,
  seasonNumber: number,
  episodeNumber: number,
  name: string,
  overview: string | null = null
): void {
  ctx.raw.run(
    `INSERT INTO episodes
      (season_id, series_tmdb_id, season_number, episode_number, name, overview, runtime_minutes)
      VALUES (?, ?, ?, ?, ?, ?, 45)`,
    [seasonId, seriesTmdbId, seasonNumber, episodeNumber, name, overview]
  );
}

async function seed(ctx: DriverContext): Promise<void> {
  /* Realistic fixture: one followed series, two seasons, 2+1 episodes,
   * two settings, two watched marks. Seasons and episodes carry
   * overview text so round-trips can assert it survives. */
  await followSeries(ctx.db, {
    tmdbId: 42,
    name: 'Test Show',
    posterPath: '/poster.jpg',
    firstAirDate: '2020-01-01',
    status: 'Returning Series',
    numberOfSeasons: 2,
    numberOfEpisodes: 3
  });
  const s1 = insertSeason(ctx, 42, 1, 2);
  const s2 = insertSeason(ctx, 42, 2, 1);
  setSeasonOverview(ctx, s1, 'Season 1 overview text');
  setSeasonOverview(ctx, s2, 'Season 2 overview text');
  insertEpisode(ctx, s1, 42, 1, 1, 'Pilot', 'Pilot synopsis');
  insertEpisode(ctx, s1, 42, 1, 2, 'Two', 'Episode 2 synopsis');
  insertEpisode(ctx, s2, 42, 2, 1, 'Premiere', 'S2 premiere synopsis');

  await setSetting(ctx.db, 'profile.name', 'Pierre');
  await setSetting(ctx.db, 'tmdb.api_key', 'secret-key');

  const epIds = ctx.raw.prepareAll<{ id: number }>(
    'SELECT id FROM episodes WHERE series_tmdb_id = 42 ORDER BY season_number, episode_number'
  );
  await markEpisodeWatched(ctx.db, epIds[0].id, new Date('2024-01-15T10:00:00Z'));
  await markEpisodeWatched(ctx.db, epIds[2].id, new Date('2024-02-20T18:00:00Z'));
}

for (const driver of DUAL_DRIVERS) {
  describe(`backup (${driver.name})`, () => {
    let ctx: DriverContext;

    beforeEach(async () => {
      ctx = await driver.setup();
    });

    afterAll(async () => {
      if (ctx) await ctx.cleanup();
    });

    describe('exportBackup', () => {
      it('stamps the format and version', async () => {
        const out = await exportBackup(ctx.db);
        expect(out.format).toBe(BACKUP_FORMAT);
        expect(out.version).toBe(BACKUP_VERSION);
        expect(out.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      });

      it('returns empty arrays for a fresh database', async () => {
        const out = await exportBackup(ctx.db);
        expect(out.settings).toEqual([]);
        expect(out.series).toEqual([]);
        expect(out.seasons).toEqual([]);
        expect(out.episodes).toEqual([]);
        expect(out.watched).toEqual([]);
      });

      it('emits watched rows keyed by coordinates, not episode_id', async () => {
        await seed(ctx);
        const out = await exportBackup(ctx.db);
        expect(out.watched).toHaveLength(2);
        for (const w of out.watched) {
          expect(w).toHaveProperty('seriesTmdbId');
          expect(w).toHaveProperty('seasonNumber');
          expect(w).toHaveProperty('episodeNumber');
          expect(w).not.toHaveProperty('episodeId');
        }
      });

      it('skips API key settings by default', async () => {
        await seed(ctx);
        const out = await exportBackup(ctx.db);
        const keys = out.settings.map((s) => s.key);
        expect(keys).toContain('profile.name');
        expect(keys).not.toContain('tmdb.api_key');
      });

      it('keeps API keys when includeSecrets is set', async () => {
        await seed(ctx);
        const out = await exportBackup(ctx.db, { includeSecrets: true });
        const keys = out.settings.map((s) => s.key);
        expect(keys).toContain('tmdb.api_key');
      });
    });

    describe('importBackup round-trip on same driver', () => {
      it('restores series + watched into a wiped database', async () => {
        await seed(ctx);
        const exported = await exportBackup(ctx.db);

        await importBackup(ctx.db, exported, { mode: 'replace' });

        expect((await getSeries(ctx.db, 42))?.name).toBe('Test Show');
        expect(await getSetting(ctx.db, 'profile.name')).toBe('Pierre');
        const watchedRows = await getRecentWatched(ctx.db);
        expect(watchedRows).toHaveLength(2);
      });

      it('preserves season + episode overview text on round-trip', async () => {
        await seed(ctx);
        const exported = await exportBackup(ctx.db);

        await importBackup(ctx.db, exported, { mode: 'replace' });

        const seasonRows = ctx.raw.prepareAll<{ season_number: number; overview: string | null }>(
          'SELECT season_number, overview FROM seasons WHERE series_tmdb_id = 42 ORDER BY season_number'
        );
        expect(seasonRows).toHaveLength(2);
        expect(seasonRows[0].overview).toBe('Season 1 overview text');
        expect(seasonRows[1].overview).toBe('Season 2 overview text');

        const episodeRows = ctx.raw.prepareAll<{
          season_number: number;
          episode_number: number;
          overview: string | null;
        }>(
          'SELECT season_number, episode_number, overview FROM episodes WHERE series_tmdb_id = 42 ORDER BY season_number, episode_number'
        );
        expect(episodeRows.map((r) => r.overview)).toEqual([
          'Pilot synopsis',
          'Episode 2 synopsis',
          'S2 premiere synopsis'
        ]);
      });

      it('preserves settings.updatedAt timestamp across round-trip', async () => {
        const customDate = new Date('2023-06-15T08:30:00Z');
        await setSetting(ctx.db, 'profile.name', 'Anchored');
        /* Force a known updatedAt — setSetting always stamps `now`. We
         * want the export to carry that exact ms and the import to
         * restore it. */
        ctx.db
          .update(settingsTable)
          .set({ updatedAt: customDate })
          .where(eq(settingsTable.key, 'profile.name'))
          .run();

        const exported = await exportBackup(ctx.db);
        const row = exported.settings.find((s) => s.key === 'profile.name');
        expect(row?.updatedAt).toBe(customDate.getTime());

        await importBackup(ctx.db, exported, { mode: 'replace' });

        const after = ctx.db
          .select({ updatedAt: settingsTable.updatedAt })
          .from(settingsTable)
          .where(eq(settingsTable.key, 'profile.name'))
          .all();
        expect(after[0].updatedAt.getTime()).toBe(customDate.getTime());
      });

      it('merge mode preserves existing rows not in the backup', async () => {
        await seed(ctx);
        const exported = await exportBackup(ctx.db);

        await followSeries(ctx.db, { tmdbId: 99, name: 'Local Only' });
        await importBackup(ctx.db, exported, { mode: 'merge' });

        expect((await getSeries(ctx.db, 99))?.name).toBe('Local Only');
        expect((await getSeries(ctx.db, 42))?.name).toBe('Test Show');
      });

      it('merge with a partial backup row does not overwrite local optional columns', async () => {
        /* Existing local row carries a status + originalName the backup
         * (from an older app version) does not know about. The backup
         * should update what it knows and leave the rest alone. */
        await followSeries(ctx.db, {
          tmdbId: 42,
          name: 'Test Show',
          status: 'Returning Series',
          numberOfSeasons: 5
        });
        await ctx.db
          .update(series)
          .set({ originalName: 'Local OG Name' })
          .where(eq(series.tmdbId, 42))
          .run();

        /* Build a minimal backup with only tmdbId + name + updated
         * numberOfSeasons. originalName/status are absent. */
        const partial = {
          format: 'episode-backup' as const,
          version: 1 as const,
          exportedAt: new Date().toISOString(),
          settings: [],
          series: [{ tmdbId: 42, name: 'Test Show (renamed)', numberOfSeasons: 6 }],
          seasons: [],
          episodes: [],
          watched: []
        };
        await importBackup(ctx.db, partial, { mode: 'merge' });

        const s = await getSeries(ctx.db, 42);
        expect(s?.name).toBe('Test Show (renamed)');
        expect(s?.numberOfSeasons).toBe(6);
        /* These were NOT in the backup — they must survive. */
        expect(s?.status).toBe('Returning Series');
        expect(s?.originalName).toBe('Local OG Name');
      });

      it('replace mode wipes everything before applying', async () => {
        await followSeries(ctx.db, { tmdbId: 99, name: 'Doomed' });
        await seed(ctx);
        const exported = await exportBackup(ctx.db);

        /* Drop all of seed's data so replace has work to do — but keep
         * one extra row to confirm it gets wiped. */
        await importBackup(
          ctx.db,
          { ...exported, series: [], episodes: [], seasons: [], watched: [], settings: [] },
          { mode: 'replace' }
        );

        expect(await getSeries(ctx.db, 42)).toBeNull();
        expect(await getSeries(ctx.db, 99)).toBeNull();
      });

      it('replace mode also wipes settings present locally but absent from backup', async () => {
        await setSetting(ctx.db, 'profile.name', 'Pierre');
        await setSetting(ctx.db, 'locale', 'fr');

        const exported = await exportBackup(ctx.db);
        await importBackup(ctx.db, { ...exported, settings: [] }, { mode: 'replace' });

        expect(await getSetting(ctx.db, 'profile.name')).toBeNull();
        expect(await getSetting(ctx.db, 'locale')).toBeNull();
      });

      it('replace mode preserves existing API keys when backup has no secrets', async () => {
        /* A user with TMDB/OMDb keys configured restores a backup that
         * was exported without secrets (the default). They should NOT
         * have to re-enter their keys after the wipe. */
        await setSetting(ctx.db, 'tmdb.api_key', 'my-tmdb-key');
        await setSetting(ctx.db, 'omdb.api_key', 'my-omdb-key');
        await setSetting(ctx.db, 'profile.name', 'Pierre');

        const exported = await exportBackup(ctx.db); // includeSecrets defaults to false
        expect(exported.settings.map((s) => s.key)).not.toContain('tmdb.api_key');

        await importBackup(ctx.db, exported, { mode: 'replace' });

        expect(await getSetting(ctx.db, 'tmdb.api_key')).toBe('my-tmdb-key');
        expect(await getSetting(ctx.db, 'omdb.api_key')).toBe('my-omdb-key');
        expect(await getSetting(ctx.db, 'profile.name')).toBe('Pierre');
      });

      it('replace + includeSecrets lets the backup override existing API keys', async () => {
        await setSetting(ctx.db, 'tmdb.api_key', 'old-key');
        await setSetting(ctx.db, 'profile.name', 'Pierre');

        const exported = await exportBackup(ctx.db, { includeSecrets: true });
        /* Tamper with the export to simulate a backup taken on another
         * machine with a different key. */
        const tamperedTmdb = exported.settings.find((s) => s.key === 'tmdb.api_key');
        if (tamperedTmdb) tamperedTmdb.value = 'new-key';

        await importBackup(ctx.db, exported, { mode: 'replace', includeSecrets: true });

        expect(await getSetting(ctx.db, 'tmdb.api_key')).toBe('new-key');
      });
    });

    describe('cross-instance import', () => {
      it('restores watched across instances with different autoincrement IDs', async () => {
        /* Seed instance A. */
        await seed(ctx);
        const exported = await exportBackup(ctx.db);

        /* Build instance B with a different shape so its episode IDs
         * land on different rowids. Insert a decoy series first so the
         * autoincrement counters differ between A and B. */
        const ctxB = await driver.setup();
        try {
          await followSeries(ctxB.db, { tmdbId: 1, name: 'Decoy' });
          insertSeason(ctxB, 1, 1, 5);
          for (let i = 1; i <= 5; i++) {
            const seasonRow = ctxB.raw.prepareAll<{ id: number }>(
              'SELECT id FROM seasons WHERE series_tmdb_id = 1'
            )[0];
            insertEpisode(ctxB, seasonRow.id, 1, 1, i, `Decoy E${i}`);
          }

          await importBackup(ctxB.db, exported);

          expect((await getSeries(ctxB.db, 42))?.name).toBe('Test Show');
          const watched = await getRecentWatched(ctxB.db);
          /* Two watched rows from instance A, keyed by coords, applied
           * to the corresponding episode rows in instance B regardless
           * of differing internal IDs. */
          expect(watched.filter((w) => w.seriesTmdbId === 42)).toHaveLength(2);
        } finally {
          await ctxB.cleanup();
        }
      });

      it('skips watched entries whose episode coordinates are not in the backup', async () => {
        await seed(ctx);
        const exported = await exportBackup(ctx.db);
        /* Forge a ghost watched entry pointing at a non-existent
         * episode — import should drop it silently. */
        exported.watched.push({
          seriesTmdbId: 42,
          seasonNumber: 9,
          episodeNumber: 9,
          watchedAt: Date.now()
        });

        const ctxB = await driver.setup();
        try {
          await importBackup(ctxB.db, exported);
          const watched = await getRecentWatched(ctxB.db);
          expect(watched).toHaveLength(2);
        } finally {
          await ctxB.cleanup();
        }
      });
    });

    describe('parseBackup validation', () => {
      it('rejects invalid JSON', () => {
        expect(() => parseBackup('not json')).toThrow(BackupImportError);
      });

      it('rejects an unknown format', () => {
        expect(() => parseBackup(JSON.stringify({ format: 'other', version: 1 }))).toThrow(
          BackupImportError
        );
      });

      it('rejects a future version', () => {
        expect(() =>
          parseBackup(
            JSON.stringify({
              format: BACKUP_FORMAT,
              version: 999,
              exportedAt: '',
              settings: [],
              series: [],
              seasons: [],
              episodes: [],
              watched: []
            })
          )
        ).toThrow(BackupImportError);
      });

      it('accepts an exported document round-tripped through JSON', async () => {
        await seed(ctx);
        const exported = await exportBackup(ctx.db);
        const parsed = parseBackup(JSON.stringify(exported));
        expect(parsed.format).toBe(BACKUP_FORMAT);
        expect(parsed.version).toBe(BACKUP_VERSION);
        expect(parsed.series).toHaveLength(1);
      });
    });
  });
}
