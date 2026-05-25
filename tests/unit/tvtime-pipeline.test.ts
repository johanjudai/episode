/**
 * Integration-style tests for the TV Time import pipeline.
 *
 * We mount a real in-memory SQLite (better-sqlite3 + the project schema)
 * so phase 1 actually writes series/season/episode rows, and phase 2
 * actually inserts watched rows. TMDB is mocked at the `fetch` boundary
 * with a tiny routing function — close enough to real behaviour to
 * exercise the resolve / sync paths, but deterministic and offline.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import BetterSqlite3 from 'better-sqlite3';
import * as schema from '../../src/lib/data/schema';
import type { Db } from '../../src/lib/data/db-types';
import { EMBEDDED_MIGRATIONS } from '../../src/lib/data/migrations';
import { importPhase1, importPhase2, type ParsedExport } from '../../src/lib/data/tvtime-pipeline';
import { mergeWatchHistory } from '../../src/lib/data/tvtime-import';
import { getEpisodeIdByCoords, getEpisodeForCoords } from '../../src/lib/data/mutations';
import { getFollowedSeries, getSeries } from '../../src/lib/data/queries';

const DDL = EMBEDDED_MIGRATIONS.map((m) => m.sql).join('\n');

let sqlite: BetterSqlite3.Database;
let db: Db;

beforeEach(() => {
  sqlite = new BetterSqlite3(':memory:');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(DDL);
  db = drizzle(sqlite, { schema }) as unknown as Db;
});

afterAll(() => sqlite?.close());

/* TMDB routing — encodes the routes we exercise. New tests pull from
 * the same payload so adding fixtures is one entry, not a per-test
 * mock setup. */
interface TmdbFixture {
  /** TheTVDB id → TMDB id (drives /find responses). */
  tvdbFind: Map<number, { id: number; name: string }>;
  /** Title → TMDB search results (drives /search/tv responses). */
  search: Map<string, { id: number; name: string }[]>;
  /** TMDB series id → detail payload. */
  detail: Map<number, unknown>;
  /** "{seriesId}/{seasonNumber}" → season payload. */
  season: Map<string, unknown>;
}

function makeFetch(fix: TmdbFixture): typeof fetch {
  return (async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const path = url.pathname;
    const ok = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });

    if (path.startsWith('/3/find/')) {
      const tvdbId = Number(decodeURIComponent(path.slice('/3/find/'.length)));
      const hit = fix.tvdbFind.get(tvdbId);
      return ok({ tv_results: hit ? [hit] : [] });
    }
    if (path === '/3/search/tv') {
      const q = url.searchParams.get('query') ?? '';
      const results = fix.search.get(q) ?? [];
      return ok({ page: 1, results, total_pages: 1, total_results: results.length });
    }
    const detailMatch = path.match(/^\/3\/tv\/(\d+)$/);
    if (detailMatch) {
      const payload = fix.detail.get(Number(detailMatch[1]));
      return payload ? ok(payload) : new Response('', { status: 404 });
    }
    const seasonMatch = path.match(/^\/3\/tv\/(\d+)\/season\/(\d+)$/);
    if (seasonMatch) {
      const key = `${seasonMatch[1]}/${seasonMatch[2]}`;
      const payload = fix.season.get(key);
      return payload ? ok(payload) : new Response('', { status: 404 });
    }
    return new Response('', { status: 404 });
  }) as unknown as typeof fetch;
}

function buildFixture(): TmdbFixture {
  return {
    tvdbFind: new Map([
      /* Twin Peaks: TheTVDB 70533 → TMDB 18164. */
      [70533, { id: 18164, name: 'Twin Peaks' }]
    ]),
    search: new Map([
      /* "Severance" via title fallback (TheTVDB id unmapped in our fixture). */
      ['Severance', [{ id: 95396, name: 'Severance', original_name: 'Severance' }]],
      /* Ambiguous title — fallback must NOT pick this if the names differ. */
      [
        'My Show',
        [
          { id: 1001, name: 'A Completely Different Show', original_name: 'X' },
          { id: 1002, name: 'Some Other Show', original_name: 'Y' }
        ]
      ]
    ]),
    detail: new Map<number, unknown>([
      [
        18164,
        {
          id: 18164,
          name: 'Twin Peaks',
          number_of_seasons: 1,
          seasons: [{ id: 1, season_number: 1, name: 'Season 1', episode_count: 2 }]
        }
      ],
      [
        95396,
        {
          id: 95396,
          name: 'Severance',
          number_of_seasons: 1,
          seasons: [{ id: 2, season_number: 1, name: 'Season 1', episode_count: 1 }]
        }
      ]
    ]),
    season: new Map<string, unknown>([
      [
        '18164/1',
        {
          id: 1,
          season_number: 1,
          episodes: [
            { id: 11, episode_number: 1, season_number: 1, name: 'Pilot', air_date: '1990-04-08' },
            {
              id: 12,
              episode_number: 2,
              season_number: 1,
              name: 'Episode 2',
              air_date: '1990-04-12'
            }
          ]
        }
      ],
      [
        '95396/1',
        {
          id: 2,
          season_number: 1,
          episodes: [
            {
              id: 21,
              episode_number: 1,
              season_number: 1,
              name: 'Good News About Hell',
              air_date: '2022-02-17'
            }
          ]
        }
      ]
    ])
  };
}

/* Override the fetch used by the tmdb client. Phase 1 builds its
 * client internally via createTmdbClient, which honors a `fetch` opt
 * — but the pipeline never passes one. So we monkey-patch the global
 * for the duration of the test. */
async function withFetch<T>(impl: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

const PAST = new Date('2022-03-22T13:36:40Z');

describe('importPhase1', () => {
  it('resolves via /find and syncs series + episodes', async () => {
    const fix = buildFixture();
    const parsed: ParsedExport = {
      follows: [{ tvdbId: 70533, name: 'Twin Peaks', followedAt: PAST, archived: false }],
      history: mergeWatchHistory([])
    };

    const summary = await withFetch(makeFetch(fix), () =>
      importPhase1(db, 'TESTKEY123', 'en-US', parsed)
    );

    expect(summary.seriesMatched).toBe(1);
    expect(summary.seriesSynced).toBe(1);
    expect(summary.unresolved).toEqual([]);
    expect(summary.syncFailed).toEqual([]);

    const stored = await getSeries(db, 18164);
    expect(stored?.name).toBe('Twin Peaks');
    /* The followed flag is preserved with the original "addedAt". */
    expect(stored?.addedAt?.getTime()).toBe(PAST.getTime());
    expect(stored?.removedAt).toBeNull();
    /* Both episodes were materialized. */
    expect(await getEpisodeIdByCoords(db, 18164, 1, 1)).not.toBeNull();
    expect(await getEpisodeIdByCoords(db, 18164, 1, 2)).not.toBeNull();
  });

  it('marks archived follows as removed but keeps the row', async () => {
    const fix = buildFixture();
    const parsed: ParsedExport = {
      follows: [{ tvdbId: 70533, name: 'Twin Peaks', followedAt: PAST, archived: true }],
      history: mergeWatchHistory([])
    };
    await withFetch(makeFetch(fix), () => importPhase1(db, 'TESTKEY123', 'en-US', parsed));

    const stored = await getSeries(db, 18164);
    expect(stored?.addedAt?.getTime()).toBe(PAST.getTime());
    expect(stored?.removedAt).not.toBeNull();
    /* Archived shows shouldn't appear in the followed list. */
    const followed = await getFollowedSeries(db);
    expect(followed).toHaveLength(0);
  });

  it('falls back to searchTv when /find returns nothing', async () => {
    const fix = buildFixture();
    /* "Severance" has no /find mapping in the fixture — only search results. */
    const parsed: ParsedExport = {
      follows: [{ tvdbId: 9999999, name: 'Severance', followedAt: PAST, archived: false }],
      history: mergeWatchHistory([])
    };
    const summary = await withFetch(makeFetch(fix), () =>
      importPhase1(db, 'TESTKEY123', 'en-US', parsed)
    );
    expect(summary.seriesMatched).toBe(1);
    expect(await getSeries(db, 95396)).not.toBeNull();
  });

  it('refuses ambiguous searchTv fallback (name mismatch)', async () => {
    const fix = buildFixture();
    /* The query "My Show" returns results whose names DON'T match —
     * the fallback must reject them and put the follow in `unresolved`,
     * not pick the wrong show. */
    const parsed: ParsedExport = {
      follows: [{ tvdbId: 9999998, name: 'My Show', followedAt: PAST, archived: false }],
      history: mergeWatchHistory([])
    };
    const summary = await withFetch(makeFetch(fix), () =>
      importPhase1(db, 'TESTKEY123', 'en-US', parsed)
    );
    expect(summary.unresolved).toEqual([{ name: 'My Show', tvdbId: 9999998 }]);
    expect(summary.seriesMatched).toBe(0);
  });
});

describe('importPhase2', () => {
  it('marks watched and falls back to air_date when watchedAt is null', async () => {
    const fix = buildFixture();
    const parsed: ParsedExport = {
      follows: [{ tvdbId: 70533, name: 'Twin Peaks', followedAt: PAST, archived: false }],
      history: mergeWatchHistory([
        {
          seriesName: 'Twin Peaks',
          seasonNumber: 1,
          episodeNumber: 1,
          watchedAt: new Date('2024-01-01T20:00:00Z'),
          type: 'watch'
        },
        /* Null watchedAt — should fall back to the episode's air_date. */
        {
          seriesName: 'Twin Peaks',
          seasonNumber: 1,
          episodeNumber: 2,
          watchedAt: null,
          type: 'watch'
        }
      ])
    };

    const phase1 = await withFetch(makeFetch(fix), () =>
      importPhase1(db, 'TESTKEY123', 'en-US', parsed)
    );
    const phase2 = await importPhase2(db, parsed, phase1.nameToTmdb);

    expect(phase2.watchesApplied).toBe(2);
    expect(phase2.watchesSkipped).toBe(0);

    const ep2 = await getEpisodeForCoords(db, 18164, 1, 2);
    expect(ep2?.airDate).toBe('1990-04-12');
    /* The watched row for episode 2 should have used the air_date,
     * NOT `new Date()` — verify via raw SQL since the high-level
     * helpers don't expose `watched.watched_at`. */
    const row = sqlite
      .prepare('SELECT watched_at FROM watched WHERE episode_id = ?')
      .get(ep2!.id) as { watched_at: number };
    /* SQLite stores Drizzle timestamps as ms-epoch integers when the
     * column is `integer({ mode: 'timestamp_ms' })`. */
    expect(new Date(row.watched_at).toISOString().startsWith('1990-04-12')).toBe(true);
  });

  it('handles series-name variations via normalization', async () => {
    const fix = buildFixture();
    /* Phase 1 maps using the curly-apostrophe variant; the watch
     * history references the straight-apostrophe variant. Without
     * the normalize() guard this would skip silently. */
    fix.tvdbFind.set(42, { id: 100, name: "Marvel's Daredevil" });
    fix.detail.set(100, {
      id: 100,
      name: "Marvel's Daredevil",
      seasons: [{ id: 1, season_number: 1, episode_count: 1 }]
    });
    fix.season.set('100/1', {
      id: 1,
      season_number: 1,
      episodes: [{ id: 1000, episode_number: 1, season_number: 1, name: 'Pilot' }]
    });

    const parsed: ParsedExport = {
      follows: [{ tvdbId: 42, name: 'Marvel’s Daredevil', followedAt: PAST, archived: false }],
      history: mergeWatchHistory([
        {
          /* Different apostrophe variant from the follow row. */
          seriesName: "Marvel's Daredevil",
          seasonNumber: 1,
          episodeNumber: 1,
          watchedAt: new Date('2024-01-01T20:00:00Z'),
          type: 'watch'
        }
      ])
    };

    const phase1 = await withFetch(makeFetch(fix), () =>
      importPhase1(db, 'TESTKEY123', 'en-US', parsed)
    );
    const phase2 = await importPhase2(db, parsed, phase1.nameToTmdb);

    expect(phase2.watchesApplied).toBe(1);
    expect(phase2.watchesSkipped).toBe(0);
  });

  it('skips watches whose series did not resolve', async () => {
    const fix = buildFixture();
    const parsed: ParsedExport = {
      follows: [],
      history: mergeWatchHistory([
        {
          seriesName: 'Ghost Series',
          seasonNumber: 1,
          episodeNumber: 1,
          watchedAt: new Date('2024-01-01T20:00:00Z'),
          type: 'watch'
        }
      ])
    };

    const phase1 = await withFetch(makeFetch(fix), () =>
      importPhase1(db, 'TESTKEY123', 'en-US', parsed)
    );
    const phase2 = await importPhase2(db, parsed, phase1.nameToTmdb);

    expect(phase2.watchesApplied).toBe(0);
    expect(phase2.watchesSkipped).toBe(1);
  });

  it('is idempotent — re-running phase 2 does not duplicate or update watchedAt', async () => {
    const fix = buildFixture();
    const parsed: ParsedExport = {
      follows: [{ tvdbId: 70533, name: 'Twin Peaks', followedAt: PAST, archived: false }],
      history: mergeWatchHistory([
        {
          seriesName: 'Twin Peaks',
          seasonNumber: 1,
          episodeNumber: 1,
          watchedAt: new Date('2024-01-01T20:00:00Z'),
          type: 'watch'
        }
      ])
    };
    const phase1 = await withFetch(makeFetch(fix), () =>
      importPhase1(db, 'TESTKEY123', 'en-US', parsed)
    );
    await importPhase2(db, parsed, phase1.nameToTmdb);
    /* Second pass should still report applied=1 (we count attempts that
     * found a target episode), but the persisted watched_at must not
     * have shifted. */
    const epId = await getEpisodeIdByCoords(db, 18164, 1, 1);
    const before = sqlite
      .prepare('SELECT watched_at FROM watched WHERE episode_id = ?')
      .get(epId!) as { watched_at: number };

    parsed.history.watches[0].watchedAt = new Date('2026-01-01T00:00:00Z');
    await importPhase2(db, parsed, phase1.nameToTmdb);

    const after = sqlite
      .prepare('SELECT watched_at FROM watched WHERE episode_id = ?')
      .get(epId!) as { watched_at: number };
    expect(after.watched_at).toBe(before.watched_at);
  });
});
