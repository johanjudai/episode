/**
 * Public DB factory for client-side code (local target).
 *
 * In **server target** builds this module is unused — routes call queries
 * directly against the Node driver via `+page.server.ts` → `$lib/server/db`.
 *
 * In **local target** builds (adapter-static + Capacitor), every route's
 * universal load and the mutation facade go through `getDb()`, which returns
 * the singleton sql.js handle (or, eventually, a Capacitor-SQLite handle).
 */
import type { Db } from '$lib/data/db-types';
import { initBrowserDb } from './db.browser';

let cached: Db | null = null;
let pending: Promise<Db> | null = null;

export async function getDb(): Promise<Db> {
  if (cached) return cached;
  if (!pending) pending = initBrowserDb();
  cached = await pending;
  return cached;
}
