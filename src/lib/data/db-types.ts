/**
 * Portable Drizzle handle type. Both better-sqlite3 and sql.js are synchronous
 * SQLite drivers exposing the same query-builder surface (BaseSQLiteDatabase).
 * Every query/mutation in `$lib/data` takes a `Db` so it works with either
 * driver without code changes.
 */
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import * as schema from './schema';

export type Schema = typeof schema;

export type Db = BaseSQLiteDatabase<'sync', unknown, Schema>;
