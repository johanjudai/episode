import { describe, it, expect } from 'vitest';
import { DEFAULT_PALETTE, PALETTES, isPalette, readStoredPalette } from '$lib/utils/palette';

class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  clear() {
    this.store.clear();
  }
  getItem(key: string) {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  key(i: number) {
    return Array.from(this.store.keys())[i] ?? null;
  }
}

describe('palette', () => {
  it('lists exactly the known palettes', () => {
    expect(PALETTES).toEqual(['bauhaus', 'ecobrutalism', 'artnouveau']);
  });

  it('defaults to bauhaus', () => {
    expect(DEFAULT_PALETTE).toBe('bauhaus');
  });

  it.each([
    ['bauhaus', true],
    ['ecobrutalism', true],
    ['artnouveau', true],
    ['nope', false],
    [null, false],
    [undefined, false],
    [42, false]
  ])('isPalette(%p) = %s', (input, expected) => {
    expect(isPalette(input)).toBe(expected);
  });

  describe('readStoredPalette', () => {
    it('falls back to default when nothing is stored', () => {
      expect(readStoredPalette(new MemoryStorage())).toBe('bauhaus');
    });

    it.each([['ecobrutalism'], ['artnouveau']])('returns valid stored value %s', (stored) => {
      const s = new MemoryStorage();
      s.setItem('episode.palette', stored);
      expect(readStoredPalette(s)).toBe(stored);
    });

    it('falls back to default when stored value is garbage', () => {
      const s = new MemoryStorage();
      s.setItem('episode.palette', 'nope');
      expect(readStoredPalette(s)).toBe('bauhaus');
    });
  });
});
