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

async function readApiKey(): Promise<string> {
  const db = await getDb();
  const key = await getSetting(db, 'tmdb.api_key');
  if (!key) throw new Error('Clé TMDB manquante');
  return key;
}

export async function syncSeriesFull(tmdbId: number, opts: sync.SyncOptions = {}): Promise<void> {
  const [db, apiKey] = await Promise.all([getDb(), readApiKey()]);
  await sync.syncSeriesFull(db, apiKey, tmdbId, opts);
}

export async function syncSeasonRow(seriesTmdbId: number, seasonNumber: number): Promise<void> {
  const [db, apiKey] = await Promise.all([getDb(), readApiKey()]);
  await sync.syncSeason(db, apiKey, seriesTmdbId, seasonNumber);
}

export async function syncEpisodeRow(
  seriesTmdbId: number,
  seasonNumber: number,
  episodeNumber: number
): Promise<void> {
  const [db, apiKey] = await Promise.all([getDb(), readApiKey()]);
  await sync.ensureEpisodeRow(db, apiKey, seriesTmdbId, seasonNumber, episodeNumber);
}
