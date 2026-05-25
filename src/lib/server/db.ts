/**
 * Node/Server-side database driver — better-sqlite3 + Drizzle.
 *
 * This module is server-only (its location under `$lib/server` enforces that
 * via SvelteKit's import boundary). The factory lives in `$lib/db.ts` and
 * dynamically picks this driver when running on the server.
 *
 * Auto-migration: on first connection the drizzle migrator runs against the
 * embedded SQL files under `./drizzle/` (overridable via
 * EPISODE_MIGRATIONS_FOLDER for the Docker image). The migrator is
 * idempotent — it tracks applied migrations in `__drizzle_migrations`, so
 * running it again on subsequent boots is a no-op. This makes the dev
 * server, CI runner, and Docker container all self-bootstrap without
 * remembering to call `npm run db:migrate` first.
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { existsSync, mkdirSync } from 'node:fs';
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

const migrationsFolder = process.env.EPISODE_MIGRATIONS_FOLDER ?? './drizzle';
if (existsSync(migrationsFolder)) {
  try {
    migrate(drizzle(sqlite), { migrationsFolder });
  } catch (err) {
    console.error('[episode] auto-migrate failed:', err);
    /* In production a failed migration means the schema is out of date
     * — every subsequent query will throw with a less useful error.
     * Exit loudly so the operator notices instead of serving 500s. In
     * dev/test, log and continue so a stale schema doesn't brick the
     * iteration loop. */
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
  }
}

export const serverDb: Db = drizzle(sqlite, { schema }) as unknown as Db;
export { sqlite };
