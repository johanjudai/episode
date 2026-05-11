import { describe, it, expect } from 'vitest';
import { countUnwatchedBefore, findInProgressSeason } from '$lib/utils/episodes';
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
    // S2E1 is unwatched but is the target → 0 before it (S1 is fully watched)
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
    // checking S2E3: S1 fully watched, S2E1+S2E2 unwatched → 2
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
    expect(countUnwatchedBefore(seasons, 2, 2)).toBe(2); // S1E1 + S2E1
  });

  it('ignores episodes after the target', () => {
    // checking S2E1 with S2E2, S2E3 unwatched — those don't count (after target)
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
    // For season 3, count unwatched in S1 (1) + S2 (1) = 2.
    // S3 own episodes are not counted.
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
