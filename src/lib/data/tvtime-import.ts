/**
 * Parse TV Time GDPR CSV exports into normalized records ready for the
 * import pipeline. Pure functions — no I/O, no DB calls. The ZIP
 * decryption lives in $lib/data/tvtime-zip; the orchestration that
 * combines parsed records with TMDB sync lives in
 * $lib/data/tvtime-pipeline.
 *
 * TV Time uses TheTVDB IDs for series (their `tv_show_id` column), so
 * the pipeline pivots to TMDB via `/find/{tvdb_id}?external_source=tvdb_id`.
 * Episode rows in the watch history don't carry IDs at all — only
 * `(series_name, season_number, episode_number)` — and we match them
 * back to a TMDB-resolved series by name.
 */
import { parseCsv } from './tvtime-csv';

export type TvTimeImportErrorCode = 'MISSING_FOLLOWED_CSV' | 'BAD_FORMAT';

export class TvTimeImportError extends Error {
  constructor(
    public code: TvTimeImportErrorCode,
    message: string,
    public cause?: unknown
  ) {
    super(message);
    this.name = 'TvTimeImportError';
  }
}

/**
 * Normalize a series name for cross-source matching.
 *
 * TV Time writes a series name differently across files (curly vs
 * straight apostrophes, "Marvel's …" vs "Marvel’s …", accented vs
 * unaccented), and TMDB may return yet another variant. Lower-casing,
 * NFD-stripping diacritics, folding apostrophes, and collapsing
 * whitespace gives us a stable key for nameToTmdb lookups and for the
 * searchTv fallback's name-match guard.
 */
export function normalizeSeriesName(name: string): string {
  /* Unicode ranges are written with \u escapes (not literal glyphs)
   * so the regex survives editor transcoding, Windows clipboard
   * round-trips, and git's CRLF/BOM stripping without surprises:
   *   ̀-ͯ  → combining diacritical marks
   *   ‘-‛  → curly + reversed single quotes
   *   ＇         → full-width apostrophe
   *   “-‟  → curly + reversed double quotes
   */
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018-\u201b\uff07]/g, "'")
    .replace(/[\u201c-\u201f]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** A series the user followed on TV Time (active or archived). */
export interface TvTimeFollow {
  /** TheTVDB id — the only stable identifier in the export. */
  tvdbId: number;
  /** Series name as TV Time displayed it (used to match watch entries). */
  name: string;
  /** When the user followed the show (TV Time clock). */
  followedAt: Date | null;
  /** TV Time "archived" flag — user dropped the show but keeps history. */
  archived: boolean;
}

/** A single watch (or rewatch) event from the user's history. */
export interface TvTimeWatch {
  seriesName: string;
  seasonNumber: number;
  episodeNumber: number;
  watchedAt: Date | null;
  /** "watch" = first-time, "rewatch" = subsequent. */
  type: 'watch' | 'rewatch';
}

function toInt(v: string | undefined): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && Number.isInteger(n) ? n : null;
}

function toDate(v: string | undefined): Date | null {
  if (!v) return null;
  /* TV Time uses 'YYYY-MM-DD HH:MM:SS' (UTC, no offset). Safari's
   * Date.parse rejects the space-separated form ("invalid date"),
   * so we normalize to ISO 8601 with the 'T' separator and an
   * explicit Z suffix before parsing. */
  const iso = v.includes('T') ? v : v.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Parse `followed_tv_show.csv`. Returns one entry per row that has a
 * valid `tv_show_id` and a non-empty name.
 *
 * "Stopped following" semantics: TV Time exposes two flags. `archived=1`
 * is the explicit user action ("hide this show from my feed but keep
 * the history"). `active=0` covers the older "deleted" path — rows
 * where the user fully dropped a series in earlier versions of the
 * app. Both must be treated as not-currently-followed, otherwise
 * series the user already stopped show up in their feed after import.
 */
export function parseFollowedShows(csv: string): TvTimeFollow[] {
  const rows = parseCsv(csv);
  const out: TvTimeFollow[] = [];
  for (const r of rows) {
    const tvdbId = toInt(r.tv_show_id);
    const name = (r.tv_show_name ?? '').trim();
    if (tvdbId === null || !name) continue;
    out.push({
      tvdbId,
      name,
      followedAt: toDate(r.created_at),
      archived: r.archived === '1' || r.active === '0'
    });
  }
  return out;
}

/**
 * Parse `tracking-prod-records-v2.csv`. The file mixes several record
 * kinds (watch events, rewatch events, per-series aggregates) — we
 * filter by the `key` column prefix to keep only the per-episode
 * watch events.
 *
 * Some rows duplicate columns under different names (`s_no` vs
 * `season_number`, `ep_no` vs `episode_number`). We always read the
 * longer name and fall back to the short one when blank — empirically
 * the v2 dumps from late 2026 occasionally drop the long form.
 */
export function parseTrackingRecordsV2(csv: string): TvTimeWatch[] {
  const rows = parseCsv(csv);
  const out: TvTimeWatch[] = [];
  for (const r of rows) {
    const key = r.key ?? '';
    let type: 'watch' | 'rewatch';
    if (key.startsWith('watch-episode-')) type = 'watch';
    else if (key.startsWith('rewatch-episode-')) type = 'rewatch';
    else continue;

    const seriesName = (r.series_name ?? '').trim();
    const season = toInt(r.season_number || r.s_no);
    const episode = toInt(r.episode_number || r.ep_no);
    if (!seriesName || season === null || episode === null) continue;

    out.push({
      seriesName,
      seasonNumber: season,
      episodeNumber: episode,
      watchedAt: toDate(r.created_at),
      type
    });
  }
  return out;
}

/**
 * Parse `tracking-prod-records.csv` (the old format kept around for
 * legacy entries). Each row is a "watched" event with no rewatch
 * distinction — we always emit type='watch'.
 */
export function parseTrackingRecordsV1(csv: string): TvTimeWatch[] {
  const rows = parseCsv(csv);
  const out: TvTimeWatch[] = [];
  for (const r of rows) {
    const seriesName = (r.tv_show_name ?? '').trim();
    const season = toInt(r.episode_season_number);
    const episode = toInt(r.episode_number);
    if (!seriesName || season === null || episode === null) continue;
    out.push({
      seriesName,
      seasonNumber: season,
      episodeNumber: episode,
      watchedAt: toDate(r.created_at),
      type: 'watch'
    });
  }
  return out;
}

export interface MergedHistory {
  /** Deduplicated watch entries — at most one row per (series, S, E). */
  watches: TvTimeWatch[];
  /** Total rewatches per (series, S, E) — kept for future support. */
  rewatches: Map<string, number>;
}

/**
 * Merge v1 + v2 watch lists. Same (series, season, episode) collapses
 * to one watch row with the earliest non-null `watchedAt` (the user's
 * "first viewing"). Additional events with the same key are counted as
 * rewatches.
 *
 * We pick the earliest date — not the latest — because the goal is to
 * preserve "first time I saw this episode" for the activity history;
 * rewatches are tracked separately.
 */
export function mergeWatchHistory(...lists: TvTimeWatch[][]): MergedHistory {
  const firsts = new Map<string, TvTimeWatch>();
  const rewatchCount = new Map<string, number>();

  for (const list of lists) {
    for (const w of list) {
      const k = `${w.seriesName}::S${w.seasonNumber}E${w.episodeNumber}`;
      const prev = firsts.get(k);
      if (!prev) {
        /* First time we see this episode in the merge. Even if TV Time
         * tagged it `rewatch` (because the original watch predates the
         * data they kept), this is "the watch we know about" — we
         * MUST NOT count it as a rewatch yet, or we'd report
         * rewatches=1 + watches=1 for an episode the user only ever
         * watched once. */
        firsts.set(k, { ...w, type: 'watch' });
        continue;
      }
      /* Already have one — this extra event is a rewatch. */
      rewatchCount.set(k, (rewatchCount.get(k) ?? 0) + 1);
      const a = w.watchedAt?.getTime();
      const b = prev.watchedAt?.getTime();
      if (a !== undefined && (b === undefined || a < b)) {
        firsts.set(k, { ...prev, watchedAt: w.watchedAt });
      }
    }
  }

  return { watches: Array.from(firsts.values()), rewatches: rewatchCount };
}
