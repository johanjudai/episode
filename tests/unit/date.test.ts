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
    it.each([
      ['today', '2026-05-11', true],
      ['yesterday', '2026-05-10', true],
      ['far past', '2020-01-01', true],
      ['tomorrow', '2026-05-12', false],
      ['null', null, false],
      ['undefined', undefined, false],
      ['empty', '', false]
    ])('%s: isReleased = %s', (_label, date, expected) => {
      expect(isReleased(date as string | null | undefined, ref)).toBe(expected);
    });
  });

  describe('daysFromNow', () => {
    it.each([
      ['today → 0', '2026-05-11', 0],
      ['future → positive', '2026-05-15', 4],
      ['past → negative', '2026-05-10', -1]
    ])('%s', (_label, date, expected) => {
      expect(daysFromNow(date, ref)).toBe(expected);
    });
  });

  describe('formatDayShortFr', () => {
    it('returns abbreviated weekday + day for a string', () => {
      const out = formatDayShortFr('2026-05-12');
      /* Node's Intl FR returns "mar." for Tuesday — we strip the dot and
       * capitalize, so the output is "Mar". */
      expect(out.weekday).toBe('Mar');
      expect(out.day).toBe(12);
    });
  });

  describe('formatDateShortFr', () => {
    it.each([
      ['2026-05-11', '11 Mai'],
      /* Intl FR abbreviations differ from a hard-coded array (e.g.
       * "janv." → "Janv" rather than "Jan"). May stays "Mai". */
      ['2026-01-01', '1 Janv']
    ])('formatDateShortFr(%s) = %s', (input, expected) => {
      expect(formatDateShortFr(input)).toBe(expected);
    });
  });

  describe('relativeFr', () => {
    it.each([
      ['today', '2026-05-11', "Aujourd'hui"],
      ['tomorrow', '2026-05-12', 'Demain'],
      ['yesterday', '2026-05-10', 'Hier'],
      ['+6 days', '2026-05-17', '+6j']
    ])('%s → %s', (_label, date, expected) => {
      expect(relativeFr(date, ref)).toBe(expected);
    });
  });
});
