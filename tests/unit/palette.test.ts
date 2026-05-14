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

  it('isPalette accepts known values only', () => {
    expect(isPalette('bauhaus')).toBe(true);
    expect(isPalette('ecobrutalism')).toBe(true);
    expect(isPalette('artnouveau')).toBe(true);
    expect(isPalette('nope')).toBe(false);
    expect(isPalette(null)).toBe(false);
    expect(isPalette(undefined)).toBe(false);
    expect(isPalette(42)).toBe(false);
  });

  it('readStoredPalette returns the default when nothing is stored', () => {
    const s = new MemoryStorage();
    expect(readStoredPalette(s)).toBe('bauhaus');
  });

  it('readStoredPalette returns a valid stored value', () => {
    const s = new MemoryStorage();
    s.setItem('episode.palette', 'ecobrutalism');
    expect(readStoredPalette(s)).toBe('ecobrutalism');
    s.setItem('episode.palette', 'artnouveau');
    expect(readStoredPalette(s)).toBe('artnouveau');
  });

  it('readStoredPalette falls back to default when stored value is garbage', () => {
    const s = new MemoryStorage();
    s.setItem('episode.palette', 'nope');
    expect(readStoredPalette(s)).toBe('bauhaus');
  });
});
