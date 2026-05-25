import { describe, it, expect } from 'vitest';
import { normalizedProgress, exceedsThreshold, resolveAxis } from '$lib/utils/swipe';

describe('normalizedProgress', () => {
  it.each([
    ['rest', 0, 100, 0],
    ['positive fraction', 50, 100, 0.5],
    ['negative fraction', -25, 100, -0.25],
    ['clamps positive', 150, 100, 1],
    ['clamps negative', -150, 100, -1],
    ['zero width is safe', 50, 0, 0],
    ['negative width is safe', 50, -10, 0]
  ])('%s: normalizedProgress(%i, %i) = %f', (_label, delta, width, expected) => {
    expect(normalizedProgress(delta, width)).toBe(expected);
  });
});

describe('exceedsThreshold', () => {
  it.each([
    ['below+', 40, 80, null],
    ['below-', -40, 80, null],
    ['zero', 0, 80, null],
    ['exact+ (strict)', 80, 80, null],
    ['exact- (strict)', -80, 80, null],
    ['past+ small', 81, 80, 'right'],
    ['past+ large', 500, 80, 'right'],
    ['past- small', -81, 80, 'left'],
    ['past- large', -500, 80, 'left']
  ] as const)('%s: exceedsThreshold(%i, %i) = %s', (_label, delta, threshold, expected) => {
    expect(exceedsThreshold(delta, threshold)).toBe(expected);
  });
});

describe('resolveAxis', () => {
  it.each([
    ['both below default lock', 3, 3, undefined, null],
    ['both small negative', -7, -7, undefined, null],
    ['horizontal+ wins', 20, 5, undefined, 'h'],
    ['horizontal- wins', -30, 8, undefined, 'h'],
    ['vertical+ wins', 5, 20, undefined, 'v'],
    ['vertical- wins', -3, -50, undefined, 'v'],
    ['custom lock not exceeded', 5, 5, 20, null],
    ['custom lock exceeded → h', 25, 5, 20, 'h']
  ] as const)('%s', (_label, dx, dy, lock, expected) => {
    expect(lock === undefined ? resolveAxis(dx, dy) : resolveAxis(dx, dy, lock)).toBe(expected);
  });
});
