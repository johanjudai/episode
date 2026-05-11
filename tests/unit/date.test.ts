import { describe, it, expect } from 'vitest';
import {
  todayIso,
  isReleased,
  daysFromNow,
  formatDayShortFr,
  formatDateShortFr,
  relativeFr
} from '$lib/utils/date';

describe('date utils', () => {
  const ref = new Date('2026-05-11T10:00:00Z'); // Lundi 11 Mai

  describe('todayIso', () => {
    it('returns YYYY-MM-DD in UTC', () => {
      expect(todayIso(ref)).toBe('2026-05-11');
    });
  });

  describe('isReleased', () => {
    it('is true for today', () => {
      expect(isReleased('2026-05-11', ref)).toBe(true);
    });
    it('is true for past dates', () => {
      expect(isReleased('2026-05-10', ref)).toBe(true);
      expect(isReleased('2020-01-01', ref)).toBe(true);
    });
    it('is false for future dates', () => {
      expect(isReleased('2026-05-12', ref)).toBe(false);
    });
    it('is false for null / undefined / empty', () => {
      expect(isReleased(null, ref)).toBe(false);
      expect(isReleased(undefined, ref)).toBe(false);
      expect(isReleased('', ref)).toBe(false);
    });
  });

  describe('daysFromNow', () => {
    it('returns 0 for today', () => {
      expect(daysFromNow('2026-05-11', ref)).toBe(0);
    });
    it('returns positive for future', () => {
      expect(daysFromNow('2026-05-15', ref)).toBe(4);
    });
    it('returns negative for past', () => {
      expect(daysFromNow('2026-05-10', ref)).toBe(-1);
    });
  });

  describe('formatDayShortFr', () => {
    it('returns abbreviated weekday + day for a string', () => {
      const out = formatDayShortFr('2026-05-12');
      expect(out.weekday).toBe('Mar');
      expect(out.day).toBe(12);
    });
  });

  describe('formatDateShortFr', () => {
    it('returns "D MMM" in French', () => {
      expect(formatDateShortFr('2026-05-11')).toBe('11 Mai');
      expect(formatDateShortFr('2026-01-01')).toBe('1 Jan');
    });
  });

  describe('relativeFr', () => {
    it('says today / tomorrow / yesterday', () => {
      expect(relativeFr('2026-05-11', ref)).toBe("Aujourd'hui");
      expect(relativeFr('2026-05-12', ref)).toBe('Demain');
      expect(relativeFr('2026-05-10', ref)).toBe('Hier');
    });
    it('shows +Nj for further future', () => {
      expect(relativeFr('2026-05-17', ref)).toBe('+6j');
    });
  });
});
