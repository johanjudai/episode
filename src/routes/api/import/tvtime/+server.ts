import { json, error } from '@sveltejs/kit';
import { serverDb } from '$lib/server/db';
import { parseTvTimeExport, TvTimeImportError } from '$lib/data/tvtime-import';
import { setSetting } from '$lib/data/mutations';
import type { RequestHandler } from './$types';

/* TV Time exports are JSON dumps that typically weigh in well under a
 * megabyte even for power users. Capping at 10 MB protects against a
 * forged multipart with a huge file from blowing memory. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const POST: RequestHandler = async ({ request }) => {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_UPLOAD_BYTES) {
    throw error(413, 'Fichier trop volumineux (max 10 Mo)');
  }
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw error(400, 'Fichier requis');
  if (file.size > MAX_UPLOAD_BYTES) {
    throw error(413, 'Fichier trop volumineux (max 10 Mo)');
  }
  const text = await file.text();
  try {
    const entries = parseTvTimeExport(text);
    await setSetting(serverDb, 'import.tvtime.staged_count', String(entries.length));
    await setSetting(serverDb, 'import.tvtime.staged_at', new Date().toISOString());
    return json({ count: entries.length });
  } catch (err) {
    if (err instanceof TvTimeImportError) throw error(400, err.message);
    throw err;
  }
};
