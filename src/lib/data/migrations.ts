/**
 * Embedded migrations for the browser/local driver.
 *
 * In server mode, drizzle-kit generates SQL files under
 * `src/lib/server/db/migrations/` that the Node migrator consumes. In local
 * mode we cannot ship a directory of files into a static bundle, so the same
 * SQL statements are embedded here as ordered tagged strings and applied with
 * sql.js' `exec` at first launch.
 *
 * Each migration is wrapped in a transaction and recorded in the
 * `__episode_migrations` table so it isn't re-applied on subsequent loads.
 * Keep this list in sync with `src/lib/server/db/migrations/` — when you add
 * a new drizzle migration, copy the SQL here too.
 */
export interface EmbeddedMigration {
  /** Stable identifier (matches the drizzle filename without extension). */
  name: string;
  /** SQL to run. Multiple statements separated by `;` are supported by sql.js. */
  sql: string;
}

const m0000_classy_masque: EmbeddedMigration = {
  name: '0000_classy_masque',
  sql: `
CREATE TABLE IF NOT EXISTS "episodes" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "season_id" integer NOT NULL,
  "series_tmdb_id" integer NOT NULL,
  "tmdb_id" integer,
  "season_number" integer NOT NULL,
  "episode_number" integer NOT NULL,
  "name" text,
  "overview" text,
  "air_date" text,
  "runtime_minutes" integer,
  "still_path" text,
  FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX IF NOT EXISTS "episodes_series_se_uniq" ON "episodes" ("series_tmdb_id","season_number","episode_number");
CREATE INDEX IF NOT EXISTS "episodes_air_idx" ON "episodes" ("air_date");
CREATE TABLE IF NOT EXISTS "seasons" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "series_tmdb_id" integer NOT NULL,
  "tmdb_id" integer,
  "season_number" integer NOT NULL,
  "name" text,
  "overview" text,
  "air_date" text,
  "episode_count" integer,
  "poster_path" text,
  FOREIGN KEY ("series_tmdb_id") REFERENCES "series"("tmdb_id") ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX IF NOT EXISTS "seasons_series_num_uniq" ON "seasons" ("series_tmdb_id","season_number");
CREATE TABLE IF NOT EXISTS "series" (
  "tmdb_id" integer PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "original_name" text,
  "overview" text,
  "poster_path" text,
  "backdrop_path" text,
  "first_air_date" text,
  "last_air_date" text,
  "status" text,
  "network" text,
  "number_of_seasons" integer,
  "number_of_episodes" integer,
  "runtime_minutes" integer,
  "added_at" integer,
  "removed_at" integer,
  "last_synced_at" integer
);
CREATE INDEX IF NOT EXISTS "series_added_idx" ON "series" ("added_at");
CREATE INDEX IF NOT EXISTS "series_removed_idx" ON "series" ("removed_at");
CREATE TABLE IF NOT EXISTS "settings" (
  "key" text PRIMARY KEY NOT NULL,
  "value" text,
  "updated_at" integer DEFAULT (unixepoch() * 1000) NOT NULL
);
CREATE TABLE IF NOT EXISTS "watched" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "episode_id" integer NOT NULL,
  "watched_at" integer DEFAULT (unixepoch() * 1000) NOT NULL,
  FOREIGN KEY ("episode_id") REFERENCES "episodes"("id") ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX IF NOT EXISTS "watched_episode_uniq" ON "watched" ("episode_id");
CREATE INDEX IF NOT EXISTS "watched_at_idx" ON "watched" ("watched_at");
`
};

const m0001_gorgeous_abomination: EmbeddedMigration = {
  name: '0001_gorgeous_abomination',
  sql: `
ALTER TABLE "series" ADD "is_anime" integer;
`
};

export const EMBEDDED_MIGRATIONS: EmbeddedMigration[] = [
  m0000_classy_masque,
  m0001_gorgeous_abomination
];

const TRACKING_DDL = `
CREATE TABLE IF NOT EXISTS "__episode_migrations" (
  "name" text PRIMARY KEY NOT NULL,
  "applied_at" integer NOT NULL DEFAULT (unixepoch() * 1000)
);
`;

/** Exec target — anything that can run a multi-statement SQL string. */
export interface SqlExecutor {
  exec(sql: string): unknown;
  /** Returns the list of migration names already applied. */
  appliedNames(): Set<string>;
  /** Records the migration as applied. */
  recordApplied(name: string): void;
}

/**
 * Apply embedded migrations against any SQL executor. Idempotent.
 * Server mode uses drizzle-kit's file migrator instead — this is the
 * browser-side equivalent so we don't ship a directory of files.
 */
export function applyEmbeddedMigrations(exec: SqlExecutor): void {
  exec.exec(TRACKING_DDL);
  const applied = exec.appliedNames();
  for (const m of EMBEDDED_MIGRATIONS) {
    if (applied.has(m.name)) continue;
    exec.exec('BEGIN;' + m.sql + 'COMMIT;');
    exec.recordApplied(m.name);
  }
}
