import { buildPostSearch, normalizeSearchTerm, SEARCH_MAX_LEN } from './search';

describe('normalizeSearchTerm', () => {
  it('trims, collapses whitespace and rejects blank input', () => {
    expect(normalizeSearchTerm('  sunset   pier ')).toBe('sunset pier');
    expect(normalizeSearchTerm('   ')).toBeNull();
    expect(normalizeSearchTerm(undefined)).toBeNull();
    expect(normalizeSearchTerm(null)).toBeNull();
  });
  it('caps the term so a huge query cannot be sent to the database', () => {
    const out = normalizeSearchTerm('x'.repeat(500))!;
    expect(out.length).toBe(SEARCH_MAX_LEN);
  });
});

describe('buildPostSearch', () => {
  it('matches the caption case-insensitively', () => {
    const w: any = buildPostSearch('Sunset');
    expect(w.OR[0]).toEqual({ caption: { contains: 'Sunset', mode: 'insensitive' } });
  });
  it('also matches the hashtag, with or without the leading #', () => {
    const withHash: any = buildPostSearch('#Sunset');
    const without: any = buildPostSearch('sunset');
    expect(withHash.OR[1]).toEqual({ hashtags: { some: { hashtag: { tag: { contains: 'sunset' } } } } });
    expect(without.OR[1]).toEqual(withHash.OR[1]);
  });
});
