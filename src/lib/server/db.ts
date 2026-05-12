/**
 * Node/Server-side database driver — better-sqlite3 + Drizzle.
 *
 * This module is server-only (its location under `$lib/server` enforces that
 * via SvelteKit's import boundary). The factory lives in `$lib/db.ts` and
 * dynamically picks this driver when running on the server.
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import * as schema from '$lib/data/schema';
import type { Db } from '$lib/data/db-types';

const dbUrl = process.env.EPISODE_DB_URL ?? './data/episode.sqlite';

if (dbUrl !== ':memory:') {
  mkdirSync(dirname(dbUrl), { recursive: true });
}

const sqlite = new Database(dbUrl);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const serverDb: Db = drizzle(sqlite, { schema }) as unknown as Db;
export { sqlite };
