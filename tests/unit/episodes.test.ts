import { describe, it, expect } from 'vitest';
import {
  countUnwatchedBefore,
  findInProgressSeason,
  pickNextPerSeries
} from '$lib/utils/episodes';
import type { SeasonProgress } from '$lib/utils/episodes';

const sample: SeasonProgress[] = [
  {
    seasonNumber: 1,
    episodes: [
      { episodeNumber: 1, watched: true },
      { episodeNumber: 2, watched: true }
    ]
  },
  {
    seasonNumber: 2,
    episodes: [
      { episodeNumber: 1, watched: false },
      { episodeNumber: 2, watched: false },
      { episodeNumber: 3, watched: false }
    ]
  }
];

describe('countUnwatchedBefore (episode mode)', () => {
  it('returns 0 when nothing precedes the target episode', () => {
    expect(countUnwatchedBefore(sample, 1, 1)).toBe(0);
  });

  it('does not count the target episode itself', () => {
    expect(countUnwatchedBefore(sample, 2, 1)).toBe(0);
  });

  it('counts unwatched in earlier seasons', () => {
    const seasons: SeasonProgress[] = [
      {
        seasonNumber: 1,
        episodes: [
          { episodeNumber: 1, watched: false },
          { episodeNumber: 2, watched: false }
        ]
      },
      {
        seasonNumber: 2,
        episodes: [{ episodeNumber: 1, watched: false }]
      }
    ];
    expect(countUnwatchedBefore(seasons, 2, 1)).toBe(2);
  });

  it('counts unwatched in same season before target', () => {
    expect(countUnwatchedBefore(sample, 2, 3)).toBe(2);
  });

  it('combines earlier-season + same-season counts', () => {
    const seasons: SeasonProgress[] = [
      { seasonNumber: 1, episodes: [{ episodeNumber: 1, watched: false }] },
      {
        seasonNumber: 2,
        episodes: [
          { episodeNumber: 1, watched: false },
          { episodeNumber: 2, watched: false }
        ]
      }
    ];
    expect(countUnwatchedBefore(seasons, 2, 2)).toBe(2);
  });

  it('ignores episodes after the target', () => {
    expect(countUnwatchedBefore(sample, 2, 1)).toBe(0);
  });
});

describe('countUnwatchedBefore (season mode)', () => {
  it('returns 0 for season 1', () => {
    expect(countUnwatchedBefore(sample, 1)).toBe(0);
  });

  it('counts only episodes in seasons strictly before target season', () => {
    const seasons: SeasonProgress[] = [
      {
        seasonNumber: 1,
        episodes: [
          { episodeNumber: 1, watched: true },
          { episodeNumber: 2, watched: false }
        ]
      },
      {
        seasonNumber: 2,
        episodes: [{ episodeNumber: 1, watched: false }]
      },
      {
        seasonNumber: 3,
        episodes: [{ episodeNumber: 1, watched: false }]
      }
    ];
    expect(countUnwatchedBefore(seasons, 3)).toBe(2);
  });

  it('handles empty input', () => {
    expect(countUnwatchedBefore([], 1, 1)).toBe(0);
    expect(countUnwatchedBefore([], 1)).toBe(0);
  });
});

describe('findInProgressSeason', () => {
  it('returns the first season with partial progress', () => {
    const seasons: SeasonProgress[] = [
      {
        seasonNumber: 1,
        episodes: [
          { episodeNumber: 1, watched: true },
          { episodeNumber: 2, watched: true }
        ]
      },
      {
        seasonNumber: 2,
        episodes: [
          { episodeNumber: 1, watched: true },
          { episodeNumber: 2, watched: false }
        ]
      },
      {
        seasonNumber: 3,
        episodes: [{ episodeNumber: 1, watched: false }]
      }
    ];
    expect(findInProgressSeason(seasons)).toBe(2);
  });

  it('returns null when no season is in progress', () => {
    const seasons: SeasonProgress[] = [
      { seasonNumber: 1, episodes: [{ episodeNumber: 1, watched: false }] }
    ];
    expect(findInProgressSeason(seasons)).toBeNull();
  });

  it('returns null when every season is complete', () => {
    const seasons: SeasonProgress[] = [
      { seasonNumber: 1, episodes: [{ episodeNumber: 1, watched: true }] }
    ];
    expect(findInProgressSeason(seasons)).toBeNull();
  });

  it('returns null on empty input', () => {
    expect(findInProgressSeason([])).toBeNull();
  });

  it('skips fully-complete seasons when finding the in-progress one', () => {
    const seasons: SeasonProgress[] = [
      {
        seasonNumber: 1,
        episodes: [
          { episodeNumber: 1, watched: true },
          { episodeNumber: 2, watched: true }
        ]
      },
      {
        seasonNumber: 2,
        episodes: [
          { episodeNumber: 1, watched: true },
          { episodeNumber: 2, watched: true }
        ]
      },
      {
        seasonNumber: 3,
        episodes: [
          { episodeNumber: 1, watched: true },
          { episodeNumber: 2, watched: false }
        ]
      }
    ];
    expect(findInProgressSeason(seasons)).toBe(3);
  });
});

describe('pickNextPerSeries', () => {
  it('returns one row per series, keeping the first occurrence', () => {
    const eps = [
      { seriesTmdbId: 1, seasonNumber: 3, episodeNumber: 1 },
      { seriesTmdbId: 1, seasonNumber: 3, episodeNumber: 2 },
      { seriesTmdbId: 1, seasonNumber: 4, episodeNumber: 1 },
      { seriesTmdbId: 2, seasonNumber: 1, episodeNumber: 5 },
      { seriesTmdbId: 2, seasonNumber: 1, episodeNumber: 6 }
    ];
    const out = pickNextPerSeries(eps);
    expect(out).toEqual([
      { seriesTmdbId: 1, seasonNumber: 3, episodeNumber: 1 },
      { seriesTmdbId: 2, seasonNumber: 1, episodeNumber: 5 }
    ]);
  });

  it('returns empty for empty input', () => {
    expect(pickNextPerSeries([])).toEqual([]);
  });

  it('preserves input order (series order, not re-sorted)', () => {
    const eps = [
      { seriesTmdbId: 2, seasonNumber: 1, episodeNumber: 1 },
      { seriesTmdbId: 1, seasonNumber: 1, episodeNumber: 1 }
    ];
    const out = pickNextPerSeries(eps);
    expect(out.map((e) => e.seriesTmdbId)).toEqual([2, 1]);
  });

  it('handles a single series with many episodes', () => {
    const eps = [
      { seriesTmdbId: 7, seasonNumber: 1, episodeNumber: 1 },
      { seriesTmdbId: 7, seasonNumber: 1, episodeNumber: 2 },
      { seriesTmdbId: 7, seasonNumber: 1, episodeNumber: 3 }
    ];
    expect(pickNextPerSeries(eps)).toHaveLength(1);
  });

  it('keeps extra fields on the kept row', () => {
    const eps = [
      { seriesTmdbId: 1, seasonNumber: 1, episodeNumber: 1, name: 'Pilot' },
      { seriesTmdbId: 1, seasonNumber: 1, episodeNumber: 2, name: 'Second' }
    ];
    expect(pickNextPerSeries(eps)[0].name).toBe('Pilot');
  });
});
