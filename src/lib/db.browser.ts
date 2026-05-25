/**
 * Browser-side database driver — sql.js (WASM SQLite) + Drizzle, persisted
 * to IndexedDB. Used in local-target builds (`EPISODE_TARGET=local`) and any
 * environment where there is no Node runtime: web preview, Capacitor WebView.
 *
 * Persistence model:
 *   - The entire database is serialized to a Uint8Array via `db.export()`.
 *   - Snapshots are written to IndexedDB on a 250 ms debounce after every
 *     successful mutation. The full file at the end of an active session
 *     stays well under a few MB even with thousands of episodes — sql.js
 *     handles MB-class files comfortably.
 *   - First load: read the snapshot from IndexedDB (if any), bootstrap a
 *     fresh DB and apply embedded migrations otherwise.
 *
 * For a future Capacitor build we can swap this driver for one backed by
 * @capacitor-community/sqlite (native filesystem) without touching any query.
 */
import { drizzle } from 'drizzle-orm/sql-js';
import type { Database as SqlJsDb, SqlJsStatic } from 'sql.js';
import { openDB, type IDBPDatabase } from 'idb';
import * as schema from '$lib/data/schema';
import type { Db } from '$lib/data/db-types';
import { applyEmbeddedMigrations, type SqlExecutor } from '$lib/data/migrations';

const IDB_NAME = 'episode';
const IDB_STORE = 'sqlite';
const IDB_KEY = 'db';
const IDB_VERSION = 1;
const PERSIST_DEBOUNCE_MS = 250;

let dbInstance: Db | null = null;
let pending: Promise<Db> | null = null;

interface BrowserDbHandle {
  drizzle: Db;
  sqlite: SqlJsDb;
  persist: () => void;
}

let handle: BrowserDbHandle | null = null;

async function openSnapshotStore(): Promise<IDBPDatabase> {
  return openDB(IDB_NAME, IDB_VERSION, {
    upgrade(idb) {
      if (!idb.objectStoreNames.contains(IDB_STORE)) {
        idb.createObjectStore(IDB_STORE);
      }
    }
  });
}

async function loadSnapshot(): Promise<Uint8Array | null> {
  const idb = await openSnapshotStore();
  const blob = (await idb.get(IDB_STORE, IDB_KEY)) as Uint8Array | undefined;
  idb.close();
  return blob ?? null;
}

async function saveSnapshot(data: Uint8Array): Promise<void> {
  const idb = await openSnapshotStore();
  await idb.put(IDB_STORE, data, IDB_KEY);
  idb.close();
}

/* The sql.js loader needs to know where to fetch the WASM binary from at
 * runtime. We resolve it through Vite's `?url` import so the asset gets
 * fingerprinted and copied to /_app/immutable/... in the static bundle. */
async function loadSqlJs(): Promise<SqlJsStatic> {
  const [{ default: initSqlJs }, wasmMod] = await Promise.all([
    import('sql.js'),
    import('sql.js/dist/sql-wasm.wasm?url') as Promise<{ default: string }>
  ]);
  return initSqlJs({ locateFile: () => wasmMod.default });
}

function makeExecutor(sqlite: SqlJsDb): SqlExecutor {
  return {
    exec(s: string) {
      sqlite.exec(s);
    },
    appliedNames() {
      const out = new Set<string>();
      const res = sqlite.exec('SELECT name FROM __episode_migrations');
      if (res.length === 0) return out;
      for (const row of res[0].values) out.add(String(row[0]));
      return out;
    },
    recordApplied(name: string) {
      const stmt = sqlite.prepare('INSERT INTO __episode_migrations (name) VALUES (?)');
      stmt.run([name]);
      stmt.free();
    }
  };
}

/* Set by withBulkWrites() to suspend per-mutation snapshots during
 * imports / mark-all flows. The wrapForPersistence interceptors check
 * this flag and skip the schedule() call while it's non-zero; once
 * the bulk operation exits, a single snapshot fires for the whole
 * batch. Module-scoped because the wrapper closes over the persist
 * function before any caller can pass a parameter. */
let bulkDepth = 0;
let persistFlush: (() => Promise<void>) | null = null;

function attachPersistence(sqlite: SqlJsDb): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let writing = false;
  let pendingWrite = false;

  async function flush() {
    if (writing) {
      pendingWrite = true;
      return;
    }
    writing = true;
    try {
      await saveSnapshot(sqlite.export());
    } catch (err) {
      console.error('[episode] failed to persist sql.js snapshot', err);
    } finally {
      writing = false;
      if (pendingWrite) {
        pendingWrite = false;
        schedule();
      }
    }
  }

  function schedule() {
    /* During a bulk operation, drop the per-mutation schedule —
     * withBulkWrites is responsible for flushing once at the end. */
    if (bulkDepth > 0) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, PERSIST_DEBOUNCE_MS);
  }

  /* Expose a synchronous-style flush that bypasses the debounce —
   * withBulkWrites uses it on exit. */
  persistFlush = async () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    await flush();
  };

  /* Snapshot one last time on tab close — losing a snapshot just means the
   * last few seconds of writes are re-applied from memory next session,
   * which can't happen in a single-page app, so we flush synchronously.
   *
   * Both events are listened: `pagehide` covers desktop tabs and bfcache
   * navigation; `visibilitychange` (state=hidden) is the only reliable
   * tab-leave signal on iOS Safari and on Android WebView (Capacitor).
   * The handler is idempotent — if we double-fire we just overwrite the
   * same IDB row with the same bytes. */
  if (typeof window !== 'undefined') {
    const flushSync = () => {
      if (timer) clearTimeout(timer);
      void saveSnapshot(sqlite.export());
    };
    window.addEventListener('pagehide', flushSync);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushSync();
    });
  }

  return schedule;
}

/**
 * Suspend per-mutation IndexedDB snapshots while `fn` runs, then flush
 * once at the end. Without this, bulk flows (TV Time import, backup
 * import, "mark all watched") trigger one full `sqlite.export()` per
 * row — for a 12k-row import that's tens of MB written to IDB N times.
 * With it, we write once.
 *
 * The flag is process-global (sql.js itself is a singleton). Nested
 * calls are reference-counted so callers can wrap freely.
 *
 * No-op on the server target: this module is never loaded there. The
 * api.ts facade decides whether to call this based on IS_LOCAL.
 */
export async function withBulkWrites<T>(fn: () => Promise<T> | T): Promise<T> {
  bulkDepth++;
  try {
    return await fn();
  } finally {
    bulkDepth--;
    if (bulkDepth === 0 && persistFlush) {
      await persistFlush();
    }
  }
}

async function init(): Promise<Db> {
  const SQL = await loadSqlJs();
  const snapshot = await loadSnapshot();
  const sqlite = snapshot ? new SQL.Database(snapshot) : new SQL.Database();
  sqlite.exec('PRAGMA foreign_keys = ON;');

  applyEmbeddedMigrations(makeExecutor(sqlite));

  const persist = attachPersistence(sqlite);

  /* drizzle/sql-js has no "after each write" hook. Wrap the prepared-statement
   * factory so any non-SELECT statement triggers a persist after execution. */
  const drz = drizzle(sqlite, { schema }) as unknown as Db;
  wrapForPersistence(sqlite, persist);

  handle = { drizzle: drz, sqlite, persist };
  return drz;
}

/**
 * Intercept sql.js' `prepare` so the executor calls our persist scheduler
 * after every successful write. SELECT statements skip the hook.
 *
 * sql.js statements expose `step`/`run`/`bind` — drizzle uses `run` for
 * inserts/updates/deletes and `getAsObject`/`step` for selects. We override
 * `Database.prototype.run` and the statement-level `run` accordingly.
 */
function wrapForPersistence(sqlite: SqlJsDb, persist: () => void): void {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const orig = sqlite.run.bind(sqlite);
  (sqlite as any).run = (...args: unknown[]) => {
    const result = (orig as any)(...args);
    persist();
    return result;
  };
  const proto = Object.getPrototypeOf(sqlite.prepare('SELECT 1'));
  if (proto && !proto.__episodePatched) {
    const stmtRun = proto.run;
    proto.run = function (...args: unknown[]) {
      const result = stmtRun.apply(this, args);
      persist();
      return result;
    };
    proto.__episodePatched = true;
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/** Returns the singleton browser DB handle, initializing it on first call. */
export async function initBrowserDb(): Promise<Db> {
  if (dbInstance) return dbInstance;
  if (!pending) pending = init();
  dbInstance = await pending;
  return dbInstance;
}

/** Force-flush any pending snapshot. Intended for tests and shutdown. */
export async function flushBrowserDb(): Promise<void> {
  if (!handle) return;
  await saveSnapshot(handle.sqlite.export());
}

/** Reset the in-memory singleton — used in tests. */
export function __resetBrowserDb(): void {
  if (handle) {
    handle.sqlite.close();
    handle = null;
  }
  dbInstance = null;
  pending = null;
}
