/**
 * GET /api/backup/export
 *
 * Returns the full JSON backup of the server-side database.
 *
 * Auth posture: like every other /api/* endpoint in Episode, this route
 * is unauthenticated. The app is mono-user and assumes the server is
 * either bound to localhost or sits behind a reverse proxy that enforces
 * auth (see README — "Deployment"). The hooks.server.ts rate-limiter
 * applies here too, so a passing curl can't dump faster than 1 req/s.
 *
 * Anyone with the deployment assumption broken can pull the full
 * watched-history + profile — exactly the same posture as /api/series/*.
 * If that ever changes, gate all /api/* uniformly, not this route alone.
 */
import { json } from '@sveltejs/kit';
import { serverDb } from '$lib/server/db';
import { exportBackup } from '$lib/data/backup';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
  const includeSecrets = url.searchParams.get('secrets') === '1';
  const backup = await exportBackup(serverDb, { includeSecrets });
  return json(backup, {
    headers: {
      'content-disposition': `attachment; filename="episode-backup-${new Date()
        .toISOString()
        .slice(0, 10)}.json"`
    }
  });
};
