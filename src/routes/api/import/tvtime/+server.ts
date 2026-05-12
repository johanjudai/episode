import { json, error } from '@sveltejs/kit';
import { serverDb } from '$lib/server/db';
import { parseTvTimeExport, TvTimeImportError } from '$lib/data/tvtime-import';
import { setSetting } from '$lib/data/mutations';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw error(400, 'Fichier requis');
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
