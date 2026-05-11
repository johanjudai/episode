export interface SeasonProgress {
  seasonNumber: number;
  episodes: Array<{ episodeNumber: number; watched: boolean }>;
}

/**
 * Count unwatched episodes strictly before (season, episode).
 * If `episode` is omitted, counts unwatched in all seasons before `season`
 * (used for season-level confirmation).
 */
export function countUnwatchedBefore(
  seasons: SeasonProgress[],
  season: number,
  episode?: number
): number {
  let count = 0;
  for (const s of seasons) {
    for (const ep of s.episodes) {
      if (ep.watched) continue;
      if (episode === undefined) {
        if (s.seasonNumber < season) count++;
      } else {
        if (s.seasonNumber < season) count++;
        else if (s.seasonNumber === season && ep.episodeNumber < episode) count++;
      }
    }
  }
  return count;
}

/** First season with strictly partial progress (0 < watched < total). */
export function findInProgressSeason(seasons: SeasonProgress[]): number | null {
  for (const s of seasons) {
    const watched = s.episodes.filter((e) => e.watched).length;
    if (watched > 0 && watched < s.episodes.length) return s.seasonNumber;
  }
  return null;
}

/**
 * Given a list of episodes already ordered by (seriesTmdbId, seasonNumber,
 * episodeNumber), keep only the first occurrence per series. That's the
 * "next episode to watch" for each series.
 */
export function pickNextPerSeries<
  T extends { seriesTmdbId: number; seasonNumber: number; episodeNumber: number }
>(episodes: T[]): T[] {
  const seen = new Set<number>();
  const out: T[] = [];
  for (const ep of episodes) {
    if (seen.has(ep.seriesTmdbId)) continue;
    seen.add(ep.seriesTmdbId);
    out.push(ep);
  }
  return out;
}
