import { describe, it, expect } from 'vitest';
import { normalizedProgress, exceedsThreshold, resolveAxis } from '$lib/utils/swipe';

describe('normalizedProgress', () => {
  it('returns 0 at rest', () => {
    expect(normalizedProgress(0, 100)).toBe(0);
  });

  it('returns fraction of width', () => {
    expect(normalizedProgress(50, 100)).toBe(0.5);
    expect(normalizedProgress(-25, 100)).toBe(-0.25);
  });

  it('clamps to [-1, 1]', () => {
    expect(normalizedProgress(150, 100)).toBe(1);
    expect(normalizedProgress(-150, 100)).toBe(-1);
  });

  it('returns 0 when width is 0 or negative (safety)', () => {
    expect(normalizedProgress(50, 0)).toBe(0);
    expect(normalizedProgress(50, -10)).toBe(0);
  });
});

describe('exceedsThreshold', () => {
  it('returns null below threshold', () => {
    expect(exceedsThreshold(40, 80)).toBeNull();
    expect(exceedsThreshold(-40, 80)).toBeNull();
    expect(exceedsThreshold(0, 80)).toBeNull();
  });

  it('returns null exactly at threshold (strict comparison)', () => {
    expect(exceedsThreshold(80, 80)).toBeNull();
    expect(exceedsThreshold(-80, 80)).toBeNull();
  });

  it('returns "right" past positive threshold', () => {
    expect(exceedsThreshold(81, 80)).toBe('right');
    expect(exceedsThreshold(500, 80)).toBe('right');
  });

  it('returns "left" past negative threshold', () => {
    expect(exceedsThreshold(-81, 80)).toBe('left');
    expect(exceedsThreshold(-500, 80)).toBe('left');
  });
});

describe('resolveAxis', () => {
  it('returns null when both axes are below lock distance', () => {
    expect(resolveAxis(3, 3)).toBeNull();
    expect(resolveAxis(-7, -7)).toBeNull();
  });

  it('returns "h" when horizontal motion dominates', () => {
    expect(resolveAxis(20, 5)).toBe('h');
    expect(resolveAxis(-30, 8)).toBe('h');
  });

  it('returns "v" when vertical motion dominates', () => {
    expect(resolveAxis(5, 20)).toBe('v');
    expect(resolveAxis(-3, -50)).toBe('v');
  });

  it('respects custom lock distance', () => {
    expect(resolveAxis(5, 5, 20)).toBeNull();
    expect(resolveAxis(25, 5, 20)).toBe('h');
  });
});
