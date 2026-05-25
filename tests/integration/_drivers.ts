/**
 * Shared dual-driver harness for integration tests.
 *
 * The query / mutation / backup contract MUST hold for both runtime
 * targets: better-sqlite3 (Node, server build) and sql.js (WASM,
 * browser / Capacitor). This module exposes a small abstraction so
 * each integration suite can iterate over both drivers without
 * duplicating ~120 lines of init / DDL / raw SQL glue per file.
 *
 * Test-specific helpers (e.g. `insertSeason`, `setSeasonOverview`)
 * are NOT in here — each suite layers them on top of `raw` because
 * the signatures differ slightly per suite. The harness gives you
 * `raw.exec` / `raw.prepareAll` / `raw.prepareGet` / `raw.lastInsertId`
 * — that's enough to write any DML in a per-suite helper.
 */
import { drizzle as drizzleNode } from 'drizzle-orm/better-sqlite3';
import { drizzle as drizzleSqlJs } from 'drizzle-orm/sql-js';
import BetterSqlite3 from 'better-sqlite3';
import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import * as schema from '../../src/lib/data/schema';
import type { Db } from '../../src/lib/data/db-types';
import { EMBEDDED_MIGRATIONS } from '../../src/lib/data/migrations';

const DDL = EMBEDDED_MIGRATIONS.map((m) => m.sql).join('\n');

export interface RawAccess {
  exec(sql: string): void;
  /** Run a parameterized statement (INSERT / UPDATE / DELETE). */
  run(sql: string, params?: unknown[]): void;
  /** Read all rows from a statement (optionally parameterized). */
  prepareAll<T = unknown>(sql: string, params?: unknown[]): T[];
  prepareGet<T = unknown>(sql: string, params?: unknown[]): T | undefined;
  /** Rowid produced by the most recent insert (cross-driver). */
  lastInsertId(): number;
}

export interface DriverContext {
  db: Db;
  raw: RawAccess;
  cleanup(): Promise<void>;
}

export interface Driver {
  name: string;
  setup(): Promise<DriverContext>;
}

const nodeDriver: Driver = {
  name: 'better-sqlite3',
  async setup(): Promise<DriverContext> {
    const sqlite = new BetterSqlite3(':memory:');
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(DDL);
    const db = drizzleNode(sqlite, { schema }) as unknown as Db;
    const raw: RawAccess = {
      exec: (s) => sqlite.exec(s),
      run: (s, params = []) => {
        sqlite.prepare(s).run(...params);
      },
      prepareAll: <T>(s: string, params: unknown[] = []) => sqlite.prepare(s).all(...params) as T[],
      prepareGet: <T>(s: string, params: unknown[] = []) =>
        sqlite.prepare(s).get(...params) as T | undefined,
      lastInsertId: () =>
        Number(
          (sqlite.prepare('SELECT last_insert_rowid() as id').get() as { id: number | bigint }).id
        )
    };
    return {
      db,
      raw,
      cleanup: async () => {
        sqlite.close();
      }
    };
  }
};

/* sql.js needs to load its WASM binary once per process. We cache the
 * SqlJsStatic across drivers (each test instantiates a fresh Database
 * off the cached static). */
let sqlJsStaticPromise: ReturnType<typeof initSqlJs> | null = null;
function loadSqlJsStatic() {
  if (!sqlJsStaticPromise) sqlJsStaticPromise = initSqlJs({});
  return sqlJsStaticPromise;
}

const sqlJsDriver: Driver = {
  name: 'sql.js',
  async setup(): Promise<DriverContext> {
    const SQL = await loadSqlJsStatic();
    const sqlite: SqlJsDatabase = new SQL.Database();
    sqlite.exec('PRAGMA foreign_keys = ON');
    sqlite.exec(DDL);
    const db = drizzleSqlJs(sqlite, { schema }) as unknown as Db;

    /* sql.js doesn't expose a typed `.all()` like better-sqlite3 —
     * exec() returns `[{ columns, values }]`. Reshape to a list of
     * column-keyed objects so callers can read fields by name. */
    function execAll<T>(sql: string, params: unknown[] = []): T[] {
      if (params.length === 0) {
        const res = sqlite.exec(sql);
        if (res.length === 0) return [];
        const { columns, values } = res[0];
        return values.map((row) => {
          const obj: Record<string, unknown> = {};
          columns.forEach((c, i) => (obj[c] = row[i]));
          return obj as T;
        });
      }
      const stmt = sqlite.prepare(sql);
      try {
        stmt.bind(params as never[]);
        const out: T[] = [];
        while (stmt.step()) out.push(stmt.getAsObject() as T);
        return out;
      } finally {
        stmt.free();
      }
    }

    const raw: RawAccess = {
      exec: (s) => sqlite.exec(s),
      run: (s, params = []) => {
        const stmt = sqlite.prepare(s);
        try {
          stmt.run(params as never[]);
        } finally {
          stmt.free();
        }
      },
      prepareAll: <T>(s: string, params: unknown[] = []) => execAll<T>(s, params),
      prepareGet: <T>(s: string, params: unknown[] = []) => execAll<T>(s, params)[0],
      lastInsertId: () => Number(execAll<{ id: number }>('SELECT last_insert_rowid() as id')[0].id)
    };
    return {
      db,
      raw,
      cleanup: async () => {
        sqlite.close();
      }
    };
  }
};

export const DUAL_DRIVERS: readonly Driver[] = [nodeDriver, sqlJsDriver];
