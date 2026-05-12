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
    const { syncEpisodeRow } = await import('./local-sync');
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
    const { syncSeasonRow } = await import('./local-sync');
    if (args.watched) await syncSeasonRow(args.seriesTmdbId, args.seasonNumber);
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
    const { syncSeriesFull } = await import('./local-sync');
    await syncSeriesFull(seriesTmdbId, { follow: true });
    await withLocalDb(async (db) => {
      const m = await import('./data/mutations');
      await m.markSeriesWatched(db, seriesTmdbId);
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
