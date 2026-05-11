import { describe, it, expect } from 'vitest';
import { resolveTheme } from '$lib/utils/theme';

describe('resolveTheme', () => {
  it('returns explicit choice for light/dark', () => {
    expect(resolveTheme('light', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('dark', true)).toBe('dark');
  });

  it('respects system preference for auto', () => {
    expect(resolveTheme('auto', true)).toBe('dark');
    expect(resolveTheme('auto', false)).toBe('light');
  });
});
