/**
 * Server-only helpers shared across `/api/*` endpoints. Centralizes
 * the small but error-prone glue that every endpoint reaches for —
 * e.g. resolving the TMDB key from settings or env — so changes
 * propagate without hunting through eight files.
 *
 * Lives under `$lib/server` so SvelteKit's import boundary rejects
 * any accidental client-side import.
 */
import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getSetting } from '$lib/data/queries';
import type { Db } from '$lib/data/db-types';

/**
 * Resolve the effective TMDB API key — DB settings first, env
 * fallback, throw a typed SvelteKit 412 if neither is set. Replaces
 * the duplicated:
 *   const apiKey = (await getSetting(...)) ?? env.EPISODE_TMDB_API_KEY ?? '';
 *   if (!apiKey) throw error(412, 'Clé TMDB manquante');
 * pattern that lived in 8 endpoints.
 */
export async function requireTmdbKey(db: Db): Promise<string> {
  const fromDb = await getSetting(db, 'tmdb.api_key');
  const key = fromDb ?? env.EPISODE_TMDB_API_KEY ?? '';
  if (!key) throw error(412, 'Clé TMDB manquante');
  return key;
}

/** Same as requireTmdbKey but doesn't throw — returns null on miss. */
export async function getTmdbKey(db: Db): Promise<string | null> {
  const fromDb = await getSetting(db, 'tmdb.api_key');
  return fromDb ?? env.EPISODE_TMDB_API_KEY ?? null;
}

/** OMDb counterpart. Returns null on miss (OMDb is optional). */
export async function getOmdbKey(db: Db): Promise<string | null> {
  const fromDb = await getSetting(db, 'omdb.api_key');
  return fromDb ?? env.EPISODE_OMDB_API_KEY ?? null;
}
