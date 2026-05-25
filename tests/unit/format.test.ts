import { describe, it, expect } from 'vitest';
import {
  formatEpisodeCode,
  formatRuntime,
  formatTotalTime,
  seriesInitials,
  initialOf
} from '$lib/utils/format';

describe('format utils', () => {
  describe('formatEpisodeCode', () => {
    it.each([
      [1, 2, 'S01E02'],
      [12, 34, 'S12E34'],
      [0, 0, 'S00E00']
    ])('formatEpisodeCode(%i, %i) = %s', (s, e, expected) => {
      expect(formatEpisodeCode(s, e)).toBe(expected);
    });
  });

  describe('formatRuntime', () => {
    it.each([
      [45, '45 min'],
      [0, ''],
      [null, ''],
      [undefined, ''],
      [-5, '']
    ])('formatRuntime(%s) = "%s"', (input, expected) => {
      expect(formatRuntime(input as number | null | undefined)).toBe(expected);
    });
  });

  describe('formatTotalTime', () => {
    it.each([
      ['under 60 stays minutes', 45, { value: 45, unit: 'min' }],
      ['60 → 1h', 60, { value: 1, unit: 'h' }],
      ['312h', 312 * 60, { value: 312, unit: 'h' }],
      ['48h', 48 * 60, { value: 48, unit: 'h' }],
      ['90 rounds to 2h', 90, { value: 2, unit: 'h' }],
      ['89 rounds to 1h', 89, { value: 1, unit: 'h' }]
    ])('%s', (_label, mins, expected) => {
      expect(formatTotalTime(mins)).toEqual(expected);
    });
  });

  describe('seriesInitials', () => {
    it.each([
      ['two words → 1st of each', 'The Bear', 'TB'],
      ['multi-word → first two', 'House of the Dragon', 'HO'],
      ['single word → first two letters', 'Severance', 'SE'],
      ['diacritics', 'Émilie en Paris', 'ÉE'],
      ['punctuation stays in word', "It's Always Sunny", 'IA'],
      ['empty → ??', '', '??'],
      ['blank → ??', '   ', '??']
    ])('%s: seriesInitials(%s) = %s', (_label, name, expected) => {
      expect(seriesInitials(name)).toBe(expected);
    });
  });

  describe('initialOf', () => {
    it('returns first letter', () => {
      expect(initialOf('Pierre')).toBe('P');
    });
  });
});
