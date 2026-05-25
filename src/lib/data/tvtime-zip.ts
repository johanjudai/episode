/**
 * Read selected CSV files from a password-protected TV Time export ZIP.
 *
 * TV Time GDPR archives are AES-encrypted ZIPs (the password is sent
 * by email alongside the download link). `@zip.js/zip.js` is the only
 * actively maintained JS lib that decrypts these — both in the browser
 * and in Node — so we wrap it with a minimal whitelist API.
 *
 * Security:
 *  - Only the whitelisted entries are extracted; everything else is
 *    skipped to avoid path traversal and to bound memory use.
 *  - Each extracted entry is capped at MAX_ENTRY_BYTES so a forged ZIP
 *    can't decompress into hundreds of MB ("ZIP bomb").
 *  - The archive is read via a BlobReader (no temp file on disk).
 */
import { BlobReader, TextWriter, ZipReader, configure, ERR_INVALID_PASSWORD } from '@zip.js/zip.js';

/* Configure zip.js ONCE at module load — not on every extract call.
 * `configure` mutates global state inside @zip.js/zip.js, so doing it
 * per-call would silently override any other module that happened to
 * configure workers/codecs differently. useWebWorkers=false keeps the
 * setup simple (no worker bundle to ship in the local target) and is
 * fast enough for the ~7 MB TV Time archive. */
configure({ useWebWorkers: false });

/* TV Time's largest CSV (wm_uc_catalog.datalake.datalake_normalized_user_action_view.csv)
 * is ~3.3 MB. We don't read that one, but tracking-prod-records-v2.csv
 * tops out at ~3 MB. 20 MB per entry gives us 6× headroom — well
 * below the multi-GB threshold a real ZIP bomb would need to do harm.
 * Overridable per call so tests can exercise the TOO_LARGE branch
 * without building a 20 MB fixture archive in memory. */
const DEFAULT_MAX_ENTRY_BYTES = 20 * 1024 * 1024;

/** Files we actually consume — everything else is ignored. */
export const TVTIME_ENTRIES = [
  'followed_tv_show.csv',
  'tracking-prod-records-v2.csv',
  'tracking-prod-records.csv',
  'user_tv_show_data.csv'
] as const;

export type TvTimeEntryName = (typeof TVTIME_ENTRIES)[number];

export class TvTimeZipError extends Error {
  constructor(
    public code: 'INVALID_ZIP' | 'BAD_PASSWORD' | 'MISSING_ENTRY' | 'TOO_LARGE',
    message: string
  ) {
    super(message);
    this.name = 'TvTimeZipError';
  }
}

/**
 * Decrypt and extract the 4 CSV files we need from a TV Time ZIP.
 *
 * Returns a map { name → CSV text }. Missing entries are omitted from
 * the map (the pipeline decides whether the omission is fatal; e.g.
 * `followed_tv_show.csv` is required, the others are nice-to-have).
 */
export async function extractTvTimeZip(
  file: Blob,
  password: string,
  opts: { maxEntryBytes?: number } = {}
): Promise<Partial<Record<TvTimeEntryName, string>>> {
  const maxEntryBytes = opts.maxEntryBytes ?? DEFAULT_MAX_ENTRY_BYTES;
  const reader = new ZipReader(new BlobReader(file), { password });
  try {
    const entries = await reader.getEntries();
    const wanted = new Set<string>(TVTIME_ENTRIES);
    const out: Partial<Record<TvTimeEntryName, string>> = {};

    for (const entry of entries) {
      const name = entry.filename;
      if (!wanted.has(name)) continue;
      if (entry.directory) continue;
      if (typeof entry.uncompressedSize === 'number' && entry.uncompressedSize > maxEntryBytes) {
        throw new TvTimeZipError(
          'TOO_LARGE',
          `Entry "${name}" declares ${entry.uncompressedSize} bytes (max ${maxEntryBytes})`
        );
      }
      if (!entry.getData) continue;
      const text = await entry.getData(new TextWriter('utf-8'));
      if (text.length > maxEntryBytes) {
        throw new TvTimeZipError(
          'TOO_LARGE',
          `Entry "${name}" expanded to ${text.length} bytes (max ${maxEntryBytes})`
        );
      }
      out[name as TvTimeEntryName] = text;
    }

    return out;
  } catch (err) {
    if (err instanceof TvTimeZipError) throw err;
    /* zip.js throws strings for password errors and Error objects for
     * everything else. Normalize to our typed error so the UI layer
     * can render translated messages. */
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === ERR_INVALID_PASSWORD || /password/i.test(msg)) {
      throw new TvTimeZipError('BAD_PASSWORD', msg);
    }
    throw new TvTimeZipError('INVALID_ZIP', msg);
  } finally {
    await reader.close().catch(() => undefined);
  }
}
