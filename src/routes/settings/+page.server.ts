import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { getSetting, setSetting } from '$lib/server/db/queries';
import { parseTvTimeExport, TvTimeImportError } from '$lib/server/tvtime-import';
import { createTmdbClient, TmdbError } from '$lib/server/tmdb';

export const load: PageServerLoad = async () => {
  const [name, hasTmdbKey] = await Promise.all([
    getSetting('profile.name'),
    getSetting('tmdb.api_key')
  ]);
  return {
    profile: { name: name ?? '' },
    tmdb: { hasKey: !!hasTmdbKey || !!process.env.EPISODE_TMDB_API_KEY }
  };
};

const ProfileForm = z.object({
  name: z.string().trim().min(1).max(80)
});

const TmdbForm = z.object({
  apiKey: z.string().trim().min(8).max(200)
});

export const actions: Actions = {
  updateProfile: async ({ request }) => {
    const form = await request.formData();
    const parsed = ProfileForm.safeParse(Object.fromEntries(form));
    if (!parsed.success) return fail(400, { error: 'Nom invalide' });
    await setSetting('profile.name', parsed.data.name);
    return { success: true, scope: 'profile' };
  },
  updateTmdbKey: async ({ request }) => {
    const form = await request.formData();
    const parsed = TmdbForm.safeParse(Object.fromEntries(form));
    if (!parsed.success) return fail(400, { error: 'Clé invalide' });
    try {
      const client = createTmdbClient({ apiKey: parsed.data.apiKey });
      await client.trendingTv('week');
    } catch (err) {
      if (err instanceof TmdbError) return fail(400, { error: `TMDB: ${err.message}` });
      return fail(500, { error: 'Validation TMDB échouée' });
    }
    await setSetting('tmdb.api_key', parsed.data.apiKey);
    return { success: true, scope: 'tmdb' };
  },
  importTvTime: async ({ request }) => {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return fail(400, { error: 'Fichier requis' });
    const text = await file.text();
    try {
      const entries = parseTvTimeExport(text);
      await setSetting('import.tvtime.staged_count', String(entries.length));
      await setSetting('import.tvtime.staged_at', new Date().toISOString());
      return {
        success: true,
        scope: 'import',
        count: entries.length
      };
    } catch (err) {
      if (err instanceof TvTimeImportError) return fail(400, { error: err.message });
      throw err;
    }
  }
};
