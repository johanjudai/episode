/**
 * POST /api/backup/import (multipart)
 *
 * Restores a JSON backup into the server-side database. Two modes:
 *   - `merge` (default): upsert, keep existing rows not in the backup.
 *   - `replace`: wipe everything then apply.
 *
 * Auth posture: see export/+server.ts. This endpoint can `replace` the
 * entire database — the deployment is responsible for not exposing it
 * unauthenticated. hooks.server.ts rate-limits at 1 req/s + 60 burst.
 *
 * Atomicity is handled inside importBackup() via a single SQLite
 * transaction — a mid-import error rolls back, leaving the user's
 * data exactly as before.
 */
import { json, error } from '@sveltejs/kit';
import { serverDb } from '$lib/server/db';
import { BackupImportError, importBackup, parseBackup } from '$lib/data/backup';
import type { RequestHandler } from './$types';

/* JSON backups stay small (qq Mo even for power users with thousands of
 * episodes). Cap at 20 MB to guard against forged multiparts. */
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export const POST: RequestHandler = async ({ request }) => {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_UPLOAD_BYTES) {
    throw error(413, 'Fichier trop volumineux (max 20 Mo)');
  }
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw error(400, 'Fichier requis');
  if (file.size > MAX_UPLOAD_BYTES) {
    throw error(413, 'Fichier trop volumineux (max 20 Mo)');
  }
  const modeRaw = form.get('mode');
  const mode = modeRaw === 'replace' ? 'replace' : 'merge';
  const includeSecrets = form.get('secrets') === '1';

  const text = await file.text();
  try {
    const backup = parseBackup(text);
    const result = await importBackup(serverDb, backup, { mode, includeSecrets });
    return json(result);
  } catch (err) {
    if (err instanceof BackupImportError) throw error(400, err.message);
    throw err;
  }
};
