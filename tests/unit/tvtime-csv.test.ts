import { describe, it, expect } from 'vitest';
import { parseCsv, parseCsvRaw } from '$lib/data/tvtime-csv';

describe('parseCsvRaw', () => {
  it('splits a simple comma-separated row', () => {
    expect(parseCsvRaw('a,b,c')).toEqual([['a', 'b', 'c']]);
  });

  it('keeps trailing empty fields', () => {
    expect(parseCsvRaw('a,,c,')).toEqual([['a', '', 'c', '']]);
  });

  it('handles LF, CRLF and mixed line endings', () => {
    expect(parseCsvRaw('a,b\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd']
    ]);
    expect(parseCsvRaw('a,b\r\nc,d\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd']
    ]);
    expect(parseCsvRaw('a,b\r\nc,d\ne,f')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['e', 'f']
    ]);
  });

  it('keeps quoted commas verbatim', () => {
    expect(parseCsvRaw('a,"b,c",d')).toEqual([['a', 'b,c', 'd']]);
  });

  it('unescapes "" inside quotes', () => {
    expect(parseCsvRaw('"He said ""hi""",end')).toEqual([['He said "hi"', 'end']]);
  });

  it('preserves leading and trailing spaces inside quotes', () => {
    expect(parseCsvRaw('"  spaced  ",b')).toEqual([['  spaced  ', 'b']]);
  });

  it('handles a trailing newline', () => {
    expect(parseCsvRaw('a,b\n')).toEqual([['a', 'b']]);
  });

  it('handles an empty input', () => {
    expect(parseCsvRaw('')).toEqual([]);
  });
});

describe('parseCsv', () => {
  it('binds rows to header columns', () => {
    const csv = 'name,age\nAlice,30\nBob,25';
    expect(parseCsv(csv)).toEqual([
      { name: 'Alice', age: '30' },
      { name: 'Bob', age: '25' }
    ]);
  });

  it('fills missing columns with empty strings', () => {
    const csv = 'a,b,c\n1,2';
    expect(parseCsv(csv)).toEqual([{ a: '1', b: '2', c: '' }]);
  });

  it('returns an empty array for header-only files', () => {
    expect(parseCsv('a,b,c')).toEqual([]);
  });
});
