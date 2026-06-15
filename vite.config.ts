import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type Plugin } from 'vite';
import { readFileSync } from 'node:fs';

const TARGET = (process.env.EPISODE_TARGET ?? 'server') as 'server' | 'local';
const IS_LOCAL = TARGET === 'local';

/* App version baked into the bundle as a literal. Used as the web/PWA
 * fallback "current version" for the update check; on the Android APK the
 * native versionName (from the ApkInstaller plugin) is the source of truth
 * since it tracks the release tag, which can run ahead of package.json. */
const APP_VERSION = (
  JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
    version: string;
  }
).version;

/**
 * In local-target builds the app runs as a static SPA — there is no server
 * runtime to execute Node-only code. SvelteKit still scans the routes
 * directory and would try to bundle `+page.server.ts`, `+server.ts`,
 * `hooks.server.ts`, and the better-sqlite3 driver under `$lib/server/`,
 * which fails because better-sqlite3 is a native Node binding.
 *
 * This plugin replaces those files with empty exports (or a passthrough
 * `handle` hook) only when EPISODE_TARGET=local, so SvelteKit synthesizes
 * a routes manifest with no server loads / actions / endpoints.
 *
 *  - Universal `+page.ts` files still run client-side and call into
 *    `$lib/db` (sql.js) via the unified API facade.
 *  - The Node driver under `$lib/server/db.ts` is also stubbed: any
 *    accidental import resolves to `undefined`, but the API endpoints that
 *    consume it are themselves stubbed so the import is never reached.
 */
function neuterServerModulesForLocal(): Plugin {
  const SERVER_PATTERNS = [
    /[\\/]\+page\.server\.ts$/,
    /[\\/]\+layout\.server\.ts$/,
    /[\\/]\+server\.ts$/
  ];
  const HOOKS_PATTERN = /[\\/]src[\\/]hooks\.server\.ts$/;
  const NODE_DRIVER_PATTERN = /[\\/]src[\\/]lib[\\/]server[\\/]db\.ts$/;
  return {
    name: 'episode:neuter-server-modules-for-local',
    enforce: 'pre',
    transform(_code, id) {
      if (!IS_LOCAL) return null;
      const normalized = id.split('?')[0];
      if (HOOKS_PATTERN.test(normalized)) {
        return 'export const handle = ({ event, resolve }) => resolve(event);';
      }
      if (NODE_DRIVER_PATTERN.test(normalized)) {
        /* Stubbed Node driver — nothing references `serverDb` in local mode
         * because the API endpoints that imported it are neutered above. */
        return 'export const serverDb = undefined; export const sqlite = undefined;';
      }
      for (const re of SERVER_PATTERNS) {
        if (re.test(normalized)) return 'export {};';
      }
      return null;
    }
  };
}

export default defineConfig({
  plugins: [neuterServerModulesForLocal(), sveltekit()],
  define: {
    __EPISODE_TARGET__: JSON.stringify(TARGET),
    __APP_VERSION__: JSON.stringify(APP_VERSION)
  },
  server: { port: 5173, strictPort: false, host: true },
  optimizeDeps: { exclude: ['better-sqlite3'] },
  ssr: { noExternal: ['drizzle-orm'] }
});
