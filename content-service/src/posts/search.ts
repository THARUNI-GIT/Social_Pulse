import { Prisma } from '@prisma/client';

export const SEARCH_MAX_LEN = 100;

/** Normalises a search term; blank/over-long input yields null (caller returns an empty page). */
export function normalizeSearchTerm(raw: unknown): string | null {
  const term = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!term) return null;
  return term.slice(0, SEARCH_MAX_LEN);
}

/**
 * Case-insensitive substring match over the caption, plus an exact match on the tag itself so
 * `#sunset` and `sunset` both find posts tagged sunset. ANDed with the caller's visibility
 * predicate by the service, so search can never widen what an account may read.
 */
export function buildPostSearch(term: string): Prisma.PostWhereInput {
  const tag = term.replace(/^#/, '').toLowerCase();
  return {
    OR: [
      { caption: { contains: term, mode: 'insensitive' } },
      { hashtags: { some: { hashtag: { tag: { contains: tag } } } } },
    ],
  };
}
