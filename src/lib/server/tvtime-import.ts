import { z } from 'zod';

/**
 * TV Time GDPR exports vary by year. The parser accepts the most common shapes
 * (tracking.json, seen_episode.json) and normalizes to a flat list.
 */

const TvTimeEpisode = z
  .object({
    show_name: z.string().optional(),
    series_name: z.string().optional(),
    show_id: z.union([z.number(), z.string()]).optional(),
    tmdb_id: z.union([z.number(), z.string()]).optional(),
    season_number: z.union([z.number(), z.string()]),
    episode_number: z.union([z.number(), z.string()]),
    watched_at: z.string().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional()
  })
  .passthrough();

export type TvTimeRecord = z.infer<typeof TvTimeEpisode>;

export interface NormalizedWatchEntry {
  seriesName: string;
  tmdbId: number | null;
  seasonNumber: number;
  episodeNumber: number;
  watchedAt: Date | null;
}

export class TvTimeImportError extends Error {
  constructor(
    message: string,
    public cause?: unknown
  ) {
    super(message);
    this.name = 'TvTimeImportError';
  }
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toDate(v: unknown): Date | null {
  if (!v || typeof v !== 'string') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseTvTimeExport(raw: string): NormalizedWatchEntry[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new TvTimeImportError('Invalid JSON', err);
  }

  // Common shapes: array, or { tracking: [...] }, or { seen_episode: [...] }
  let records: unknown[];
  if (Array.isArray(data)) {
    records = data;
  } else if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    const candidate =
      obj.tracking ??
      obj.seen_episode ??
      obj.seen_episodes ??
      obj.episodes ??
      obj.records ??
      obj.data;
    if (!Array.isArray(candidate)) {
      throw new TvTimeImportError(
        'Unrecognized TV Time export shape (expected array or {tracking|seen_episode}[])'
      );
    }
    records = candidate;
  } else {
    throw new TvTimeImportError('Export must be a JSON array or object with records');
  }

  const out: NormalizedWatchEntry[] = [];
  for (const rec of records) {
    const parsed = TvTimeEpisode.safeParse(rec);
    if (!parsed.success) continue;
    const r = parsed.data;

    const seriesName = r.show_name ?? r.series_name ?? '';
    const season = toNumber(r.season_number);
    const ep = toNumber(r.episode_number);
    if (!seriesName || season === null || ep === null) continue;

    out.push({
      seriesName: seriesName.trim(),
      tmdbId: toNumber(r.tmdb_id ?? r.show_id),
      seasonNumber: season,
      episodeNumber: ep,
      watchedAt: toDate(r.watched_at ?? r.created_at ?? r.updated_at)
    });
  }

  return out;
}

/** Group normalized entries by series, keeping only the latest watchedAt per episode. */
export function groupBySeries(
  entries: NormalizedWatchEntry[]
): Map<string, NormalizedWatchEntry[]> {
  const dedup = new Map<string, NormalizedWatchEntry>();
  for (const e of entries) {
    const key = `${e.seriesName}::S${e.seasonNumber}E${e.episodeNumber}`;
    const prev = dedup.get(key);
    if (!prev) {
      dedup.set(key, e);
      continue;
    }
    const a = e.watchedAt?.getTime() ?? 0;
    const b = prev.watchedAt?.getTime() ?? 0;
    if (a > b) dedup.set(key, e);
  }

  const out = new Map<string, NormalizedWatchEntry[]>();
  for (const e of dedup.values()) {
    const list = out.get(e.seriesName) ?? [];
    list.push(e);
    out.set(e.seriesName, list);
  }
  return out;
}
