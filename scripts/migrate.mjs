#!/usr/bin/env node
/**
 * Standalone migration runner — no app imports, just drizzle + the
 * migrations folder. Used by the Docker entrypoint before the server
 * starts, and locally via `npm run db:migrate`.
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const dbUrl = process.env.EPISODE_DB_URL ?? './data/episode.sqlite';
const migrationsFolder =
  process.env.EPISODE_MIGRATIONS_FOLDER ?? resolve(process.cwd(), 'migrations');

if (dbUrl !== ':memory:') {
  mkdirSync(dirname(dbUrl), { recursive: true });
}

if (!existsSync(migrationsFolder)) {
  console.error(`Migrations folder not found: ${migrationsFolder}`);
  process.exit(1);
}

const sqlite = new Database(dbUrl);
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('journal_mode = WAL');
const db = drizzle(sqlite);
migrate(db, { migrationsFolder });
console.log(`✓ Migrations applied to ${dbUrl}`);
sqlite.close();
