import { describe, it, expect } from 'vitest';
import {
  computeEtaSeconds,
  computeOverallPercent,
  estimateTotalMinutes,
  formatEta,
  selectMessage
} from '$lib/utils/import-progress';

describe('computeOverallPercent', () => {
  it('returns 0 when no progress yet', () => {
    expect(computeOverallPercent(null)).toBe(0);
  });

  it('jumps to ~3% on parse', () => {
    expect(computeOverallPercent({ phase: 'parse', current: 0, total: 1 })).toBe(3);
  });

  it('interpolates linearly inside the resolve band', () => {
    expect(computeOverallPercent({ phase: 'resolve', current: 0, total: 100 })).toBe(3);
    /* 50/100 between 3 and 80 → midpoint ≈ 41 */
    expect(computeOverallPercent({ phase: 'resolve', current: 50, total: 100 })).toBe(42);
    expect(computeOverallPercent({ phase: 'resolve', current: 100, total: 100 })).toBe(80);
  });

  it('interpolates inside the mark band', () => {
    expect(computeOverallPercent({ phase: 'mark', current: 0, total: 1000 })).toBe(80);
    expect(computeOverallPercent({ phase: 'mark', current: 1000, total: 1000 })).toBe(99);
  });

  it('returns 100 on done', () => {
    expect(computeOverallPercent({ phase: 'done', current: 1, total: 1 })).toBe(100);
  });

  it('survives total=0 without dividing by zero', () => {
    expect(computeOverallPercent({ phase: 'mark', current: 0, total: 0 })).toBe(80);
  });
});

describe('computeEtaSeconds', () => {
  it('returns null below 5%', () => {
    expect(computeEtaSeconds(0, 10_000, 3)).toBeNull();
  });

  it('returns null at or above 100%', () => {
    expect(computeEtaSeconds(0, 10_000, 100)).toBeNull();
  });

  it('extrapolates from elapsed + percent', () => {
    /* 30 s elapsed at 30 % done → total ~100 s, remaining ~70 s. */
    expect(computeEtaSeconds(0, 30_000, 30)).toBe(70);
  });

  it('requires at least 1 s of elapsed time', () => {
    expect(computeEtaSeconds(0, 500, 10)).toBeNull();
  });
});

describe('formatEta', () => {
  it('shows seconds below a minute', () => {
    expect(formatEta(45)).toBe('45 s');
  });

  it('rounds to minutes above', () => {
    expect(formatEta(120)).toBe('2 min');
    expect(formatEta(95)).toBe('2 min');
  });
});

describe('estimateTotalMinutes', () => {
  it('grows with series + watches counts', () => {
    const a = estimateTotalMinutes(50, 1000);
    const b = estimateTotalMinutes(200, 5000);
    expect(b).toBeGreaterThan(a);
  });

  it('floors at 1 minute', () => {
    expect(estimateTotalMinutes(0, 0)).toBe(1);
  });
});

describe('selectMessage', () => {
  it('uses warmup before any progress', () => {
    expect(selectMessage(null)).toBe('warmup');
    expect(selectMessage({ phase: 'parse', current: 0, total: 1 })).toBe('warmup');
  });

  it('greets with series-wow on the first resolve emit', () => {
    expect(selectMessage({ phase: 'resolve', current: 0, total: 100 })).toBe('series-wow');
  });

  it('progresses through resolve / sync bands', () => {
    expect(selectMessage({ phase: 'resolve', current: 10, total: 100 })).toBe('resolving');
    expect(selectMessage({ phase: 'sync', current: 40, total: 100 })).toBe('resolving-mid');
    expect(selectMessage({ phase: 'sync', current: 75, total: 100 })).toBe('syncing');
    expect(selectMessage({ phase: 'sync', current: 95, total: 100 })).toBe('syncing-tail');
  });

  it('progresses through mark bands', () => {
    expect(selectMessage({ phase: 'mark', current: 0, total: 1000 })).toBe('marking-start');
    expect(selectMessage({ phase: 'mark', current: 500, total: 1000 })).toBe('marking-mid');
    expect(selectMessage({ phase: 'mark', current: 950, total: 1000 })).toBe('marking-tail');
  });

  it('reports finalizing on done', () => {
    expect(selectMessage({ phase: 'done', current: 1, total: 1 })).toBe('finalizing');
  });
});
