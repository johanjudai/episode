/**
 * Helpers for the full-page import experience: turn the discrete
 * pipeline progress events into a smooth overall percentage, estimate
 * time remaining, and pick which fun message to surface next.
 *
 * Kept separate from the Svelte component so they can be unit-tested
 * in isolation (no DOM, no transitions, no i18n binding).
 */
import type { ImportProgress } from '$lib/data/tvtime-pipeline';
import type { ImportErrorCode } from '$lib/api';

/**
 * Map an `ImportError.code` to its i18n key. Centralised so settings
 * and onboarding can't drift in how they translate the same error.
 */
export function importErrorKey(code: ImportErrorCode): string {
  switch (code) {
    case 'BAD_PASSWORD':
      return 'settings.importErrorBadPassword';
    case 'INVALID_ZIP':
      return 'settings.importErrorInvalidZip';
    case 'MISSING_FOLLOWED_CSV':
      return 'settings.importErrorMissingFollowed';
    case 'FILE_TOO_LARGE':
      return 'settings.importErrorFileTooLarge';
    case 'TMDB_KEY_MISSING':
      return 'settings.importErrorTmdbMissing';
    case 'CONCURRENT_IMPORT':
      return 'settings.importErrorConcurrent';
    case 'FILE_REQUIRED':
      return 'settings.fileRequired';
    case 'PASSWORD_REQUIRED':
      return 'settings.importPasswordRequired';
    case 'INTERNAL':
    default:
      return 'settings.importErrorInternal';
  }
}

/* Weighted phase splits, summing to ~100%.
 *
 *   parse:           0 → 3       (1-2 s — almost free, mostly a marker)
 *   resolve + sync:  3 → 80      (the bulk: ~1-2 s per series)
 *   mark:            80 → 99     (very fast — ~1 ms per watch)
 *   done:            100         (only on phase=done)
 *
 * The resolve and sync phases share the same i counter (they're
 * interleaved inside the per-series loop), so we treat them as a
 * single block and just map `current/total` to that band. */
const PHASE_BANDS: Record<ImportProgress['phase'], readonly [number, number]> = {
  parse: [0, 3],
  resolve: [3, 80],
  sync: [3, 80],
  mark: [80, 99],
  done: [100, 100]
};

export function computeOverallPercent(p: ImportProgress | null): number {
  if (!p) return 0;
  const [from, to] = PHASE_BANDS[p.phase];
  if (p.phase === 'done') return 100;
  if (p.phase === 'parse') return to;
  const ratio = p.total > 0 ? Math.min(1, Math.max(0, p.current / p.total)) : 0;
  return Math.round(from + (to - from) * ratio);
}

/** ETA in seconds. Returns null until we have a non-trivial sample
 *  (5 % done at minimum) — extrapolating from the parse phase
 *  produces wildly unstable estimates that flash huge numbers
 *  before settling. */
export function computeEtaSeconds(startedAt: number, now: number, percent: number): number | null {
  if (percent < 5 || percent >= 100) return null;
  const elapsed = Math.max(0, (now - startedAt) / 1000);
  if (elapsed < 1) return null;
  const total = elapsed / (percent / 100);
  return Math.max(0, Math.round(total - elapsed));
}

export function formatEta(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const m = Math.round(seconds / 60);
  return `${m} min`;
}

/**
 * Pick which fun message to surface based on the current snapshot.
 *
 * Returns a stable id so the Svelte side can drive enter/leave
 * transitions on key changes. The text + interpolation is done in
 * the component (it owns the i18n binding).
 */
export interface MessageContext {
  /** Number of series in the export (known after parse, propagated
   *  to the component via the wrapping flow). */
  seriesCount: number | null;
  /** Number of watch records in the export. */
  watchCount: number | null;
}

export type MessageId =
  | 'warmup'
  | 'series-wow'
  | 'resolving'
  | 'resolving-mid'
  | 'syncing'
  | 'syncing-tail'
  | 'marking-start'
  | 'marking-mid'
  | 'marking-tail'
  | 'finalizing';

export function selectMessage(p: ImportProgress | null): MessageId {
  if (!p || p.phase === 'parse') return 'warmup';
  if (p.phase === 'resolve' || p.phase === 'sync') {
    const ratio = p.total > 0 ? p.current / p.total : 0;
    if (p.current === 0) return 'series-wow';
    if (ratio < 0.3) return 'resolving';
    if (ratio < 0.6) return 'resolving-mid';
    if (ratio < 0.9) return 'syncing';
    return 'syncing-tail';
  }
  if (p.phase === 'mark') {
    const ratio = p.total > 0 ? p.current / p.total : 0;
    if (ratio < 0.1) return 'marking-start';
    if (ratio < 0.85) return 'marking-mid';
    return 'marking-tail';
  }
  return 'finalizing';
}

/** Up-front rough estimate so we can show a "this may take ~X min"
 *  hint BEFORE any progress event fires. Tuned to the empirical
 *  ~1.5 s/series for the resolve+sync band (the bottleneck) plus
 *  ~3 ms/watch for the mark phase. */
export function estimateTotalMinutes(seriesCount: number, watchCount: number): number {
  const seconds = seriesCount * 1.5 + watchCount * 0.003 + 5;
  return Math.max(1, Math.round(seconds / 60));
}
