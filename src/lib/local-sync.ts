/**
 * Browser-side wrapper around the TMDB sync helpers. Reads the API key from
 * the local sql.js DB (settings table) and forwards to the pure functions in
 * `$lib/data/sync`.
 *
 * Server target builds never reach this file: the API facade (`$lib/api.ts`)
 * only routes here when `IS_LOCAL`.
 */
import { getDb } from './db';
import { getSetting } from './data/queries';
import * as sync from './data/sync';

export async function readApiKey(): Promise<string> {
  const db = await getDb();
  const key = await getSetting(db, 'tmdb.api_key');
  if (!key) throw new Error('Clé TMDB manquante');
  return key;
}

/* Map the stored locale ('fr' | 'en') to the BCP-47 language code TMDB
 * accepts. Fallback to fr-FR matches the previous (locale-agnostic)
 * behaviour for users who haven't picked a language yet. */
export async function readLanguage(): Promise<string> {
  const db = await getDb();
  const locale = await getSetting(db, 'locale');
  return locale === 'en' ? 'en-US' : 'fr-FR';
}

export async function syncSeriesFull(tmdbId: number, opts: sync.SyncOptions = {}): Promise<void> {
  const [db, apiKey, language] = await Promise.all([getDb(), readApiKey(), readLanguage()]);
  await sync.syncSeriesFull(db, apiKey, tmdbId, { language, ...opts });
}

export async function syncSeasonRow(seriesTmdbId: number, seasonNumber: number): Promise<void> {
  const [db, apiKey, language] = await Promise.all([getDb(), readApiKey(), readLanguage()]);
  await sync.syncSeason(db, apiKey, seriesTmdbId, seasonNumber, { language });
}

export async function syncEpisodeRow(
  seriesTmdbId: number,
  seasonNumber: number,
  episodeNumber: number
): Promise<void> {
  const [db, apiKey, language] = await Promise.all([getDb(), readApiKey(), readLanguage()]);
  await sync.ensureEpisodeRow(db, apiKey, seriesTmdbId, seasonNumber, episodeNumber, { language });
}

/* Locale-switch re-sync — iterate every followed series and refresh
 * its TMDB-localized fields. Sequential across series to stay polite
 * with TMDB's rate limit; per-series the seasons are parallelized by
 * syncSeriesFull. */
export async function resyncAllForLocale(): Promise<{ count: number }> {
  const [db, apiKey, language] = await Promise.all([getDb(), readApiKey(), readLanguage()]);
  const { getFollowedSeries } = await import('./data/queries');
  const followed = await getFollowedSeries(db);
  for (const s of followed) {
    await sync.syncSeriesFull(db, apiKey, s.tmdbId, { language, refresh: true }).catch((err) => {
      /* Per-series failure: log but keep going. The next mark/visit on
       * that series will retry. Silencing entirely (the previous
       * behaviour) hid TMDB auth/quota errors and made "0 success"
       * runs look like nothing happened. */
      console.warn(`[resync-locale] failed for series ${s.tmdbId} (${s.name}):`, err);
    });
  }
  return { count: followed.length };
}
