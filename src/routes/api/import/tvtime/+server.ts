import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { serverDb } from '$lib/server/db';
import { getSetting, getFollowedSeries } from '$lib/data/queries';
import { setSetting } from '$lib/data/mutations';
import {
  parseTvTimeExport,
  importPhase1,
  importPhase2,
  TvTimeImportError,
  TvTimeZipError,
  type ImportProgress
} from '$lib/data/tvtime-pipeline';
import type { RequestHandler } from './$types';

/* Error responses use typed codes so the client can render a localized
 * message. The `message` field is a developer-facing fallback (logs,
 * curl probes) — it's deliberately English/neutral so it doesn't lie
 * to a French user when no JSON parsing happens on the client side. */
type ErrorCode =
  | 'FILE_TOO_LARGE'
  | 'FILE_REQUIRED'
  | 'PASSWORD_REQUIRED'
  | 'TMDB_KEY_MISSING'
  | 'BAD_PASSWORD'
  | 'INVALID_ZIP'
  | 'MISSING_FOLLOWED_CSV'
  | 'CONCURRENT_IMPORT'
  | 'INTERNAL';

function failure(status: number, code: ErrorCode, message: string): never {
  throw error(status, { message, code });
}

/* TV Time ZIPs sit under ~10 MB even for power users with a decade
 * of history (largest CSV in the archive is ~3 MB). 50 MB gives us
 * 5× headroom while keeping the resident set bounded on small
 * deployments (a 256 MB container can survive a forged upload here:
 * we end up holding the multipart Blob + the extracted text +
 * zip.js work buffers ≈ 3× the upload size). */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const PROGRESS_KEY = 'import.tvtime.progress';
const SUMMARY_KEY = 'import.tvtime.summary';

/* In-memory guard against concurrent imports. Self-hosted Episode is
 * single-user, but a double-click or a stale tab can fire two POSTs
 * and they'd both stream progress into the same settings keys. The
 * flag is process-scoped, which matches the single-Node deployment
 * model. */
let importRunning = false;

/* Throttle settings writes so a 12k-row history doesn't burn 240+
 * progress writes during phase 2. We always emit phase transitions
 * (so the UI updates promptly when work moves between phases) and
 * the final 'done' marker; everything else respects the cool-down. */
const PROGRESS_THROTTLE_MS = 800;
let lastProgressWriteAt = 0;
let lastProgressPhase = '';

async function writeProgress(p: ImportProgress): Promise<void> {
  const now = Date.now();
  const phaseChanged = p.phase !== lastProgressPhase;
  if (!phaseChanged && p.phase !== 'done' && now - lastProgressWriteAt < PROGRESS_THROTTLE_MS) {
    return;
  }
  lastProgressWriteAt = now;
  lastProgressPhase = p.phase;
  await setSetting(serverDb, PROGRESS_KEY, JSON.stringify(p));
}

export const POST: RequestHandler = async ({ request }) => {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_UPLOAD_BYTES) {
    failure(413, 'FILE_TOO_LARGE', 'Upload exceeds the size cap');
  }
  if (importRunning) {
    failure(409, 'CONCURRENT_IMPORT', 'An import is already running');
  }

  const form = await request.formData();
  const file = form.get('file');
  const password = form.get('password');
  if (!(file instanceof File)) failure(400, 'FILE_REQUIRED', 'File missing from multipart');
  if (typeof password !== 'string' || password.length === 0) {
    failure(400, 'PASSWORD_REQUIRED', 'ZIP password missing');
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    failure(413, 'FILE_TOO_LARGE', 'Upload exceeds the size cap');
  }

  const apiKey = (await getSetting(serverDb, 'tmdb.api_key')) ?? env.EPISODE_TMDB_API_KEY ?? '';
  if (!apiKey) {
    failure(412, 'TMDB_KEY_MISSING', 'TMDB API key not configured');
  }
  const storedLocale = await getSetting(serverDb, 'locale');
  const language = storedLocale === 'en' ? 'en-US' : 'fr-FR';

  /* Clear stale state from a prior run so the progress poller doesn't
   * read leftover counters. */
  await setSetting(serverDb, PROGRESS_KEY, null);
  await setSetting(serverDb, SUMMARY_KEY, null);
  lastProgressWriteAt = 0;
  lastProgressPhase = '';
  importRunning = true;

  try {
    const parsed = await parseTvTimeExport(file, password, writeProgress);
    const p1 = await importPhase1(serverDb, apiKey, language, parsed, writeProgress);
    const p2 = await importPhase2(serverDb, parsed, p1.nameToTmdb, writeProgress);

    const summary = {
      seriesMatched: p1.seriesMatched,
      seriesSynced: p1.seriesSynced,
      syncFailed: p1.syncFailed,
      unresolved: p1.unresolved,
      watchesApplied: p2.watchesApplied,
      watchesSkipped: p2.watchesSkipped,
      followedTotal: (await getFollowedSeries(serverDb)).length
    };
    await setSetting(serverDb, SUMMARY_KEY, JSON.stringify(summary));
    return json(summary);
  } catch (err) {
    /* Wipe the progress key on failure so a polling client doesn't
     * keep showing the last counter from this aborted run. */
    await setSetting(serverDb, PROGRESS_KEY, null).catch(() => undefined);
    if (err instanceof TvTimeZipError) {
      /* A wrong ZIP password is NOT an HTTP auth failure — keep it
       * a 400 so reverse proxies don't mistake it for the app's
       * auth layer. The client maps codes to localized messages. */
      const code: ErrorCode = err.code === 'BAD_PASSWORD' ? 'BAD_PASSWORD' : 'INVALID_ZIP';
      failure(400, code, err.message);
    }
    if (err instanceof TvTimeImportError) {
      const code: ErrorCode =
        err.code === 'MISSING_FOLLOWED_CSV' ? 'MISSING_FOLLOWED_CSV' : 'INVALID_ZIP';
      failure(400, code, err.message);
    }
    /* Unknown failure: surface a generic 500 but keep the underlying
     * message in the server log so we can diagnose. SvelteKit's
     * default 500 page would leak the stack trace otherwise. */
    console.error('[import-tvtime] unexpected error', err);
    failure(500, 'INTERNAL', 'Import failed');
  } finally {
    importRunning = false;
  }
};

export const GET: RequestHandler = async () => {
  const progress = await getSetting(serverDb, PROGRESS_KEY);
  const summary = await getSetting(serverDb, SUMMARY_KEY);
  return json({
    progress: progress ? JSON.parse(progress) : null,
    summary: summary ? JSON.parse(summary) : null,
    running: importRunning
  });
};
