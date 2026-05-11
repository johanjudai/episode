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
    it('zero-pads to 2 digits', () => {
      expect(formatEpisodeCode(1, 2)).toBe('S01E02');
      expect(formatEpisodeCode(12, 34)).toBe('S12E34');
    });
    it('handles single-digit season and episode', () => {
      expect(formatEpisodeCode(0, 0)).toBe('S00E00');
    });
  });

  describe('formatRuntime', () => {
    it('formats minutes with unit', () => {
      expect(formatRuntime(45)).toBe('45 min');
    });
    it('returns empty for falsy / non-positive values', () => {
      expect(formatRuntime(0)).toBe('');
      expect(formatRuntime(null)).toBe('');
      expect(formatRuntime(undefined)).toBe('');
      expect(formatRuntime(-5)).toBe('');
    });
  });

  describe('formatTotalTime', () => {
    it('stays in minutes under 60', () => {
      expect(formatTotalTime(45)).toEqual({ value: 45, unit: 'min' });
    });
    it('switches to hours past 60 minutes', () => {
      expect(formatTotalTime(60)).toEqual({ value: 1, unit: 'h' });
      expect(formatTotalTime(312 * 60)).toEqual({ value: 312, unit: 'h' });
      expect(formatTotalTime(48 * 60)).toEqual({ value: 48, unit: 'h' });
    });
    it('rounds half-hours to the nearest hour', () => {
      expect(formatTotalTime(90)).toEqual({ value: 2, unit: 'h' });
      expect(formatTotalTime(89)).toEqual({ value: 1, unit: 'h' });
    });
  });

  describe('seriesInitials', () => {
    it('takes first letter of two words', () => {
      expect(seriesInitials('The Bear')).toBe('TB');
      expect(seriesInitials('House of the Dragon')).toBe('HO');
    });
    it('takes first two letters of single word', () => {
      expect(seriesInitials('Severance')).toBe('SE');
    });
    it('handles diacritics and punctuation', () => {
      expect(seriesInitials('Émilie en Paris')).toBe('ÉE');
      expect(seriesInitials("It's Always Sunny")).toBe('IA');
    });
    it('returns ?? when empty', () => {
      expect(seriesInitials('')).toBe('??');
      expect(seriesInitials('   ')).toBe('??');
    });
  });

  describe('initialOf', () => {
    it('returns first letter', () => {
      expect(initialOf('Pierre')).toBe('P');
    });
  });
});
