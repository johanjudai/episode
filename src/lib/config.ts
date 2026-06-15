/**
 * Build target & runtime configuration.
 *
 * EPISODE_TARGET is set at build time:
 *   - 'server' (default) — adapter-node, all data access happens server-side
 *     via better-sqlite3. Form actions go to `/api/*` endpoints.
 *   - 'local'  — adapter-static, SPA mounted in a Capacitor WebView or any
 *     browser. Data access happens client-side via sql.js, persisted to
 *     IndexedDB. No server.
 *
 * The flag is injected by Vite's `define` (see vite.config.ts) so it is a
 * literal constant in the bundles and dead branches are eliminated.
 */
export type Target = 'server' | 'local';

declare const __EPISODE_TARGET__: Target;
declare const __APP_VERSION__: string;

export const TARGET: Target =
  typeof __EPISODE_TARGET__ !== 'undefined' ? __EPISODE_TARGET__ : 'server';

export const IS_LOCAL = TARGET === 'local';
export const IS_SERVER_TARGET = TARGET === 'server';

/** Build-time app version (package.json), injected by Vite `define`. */
export const APP_VERSION: string =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
