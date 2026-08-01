import { describe, it, expect } from 'vitest';
import { mergeDyadWords, lookupDyadWord } from '@/lib/corpus';
import type { DyadCustomWord } from '@/lib/corpus';

// Pure-function tests for the dyad-scoped merge/lookup helpers (see CONTEXT.md's Custom
// Vocabulary Word entry) — no mocking needed since these don't touch the shared retriever's
// mutable state, which is the point: isolation comes from the caller passing only one dyad's
// rows in, not from any shared state these functions could leak through.

describe('mergeDyadWords', () => {
  it('appends a matching-category, non-preference-pointer word to the base vocab', () => {
    const words: DyadCustomWord[] = [{ word: 'bob', category: 'topic', is_preference_pointer: false }];
    expect(mergeDyadWords(['park', 'zoo'], words, 'topic')).toEqual(['park', 'zoo', 'bob']);
  });

  it('excludes preference-pointer words — the word already exists in the base vocab', () => {
    const words: DyadCustomWord[] = [{ word: 'red', category: 'topic', is_preference_pointer: true }];
    expect(mergeDyadWords(['red', 'blue'], words, 'topic')).toEqual(['red', 'blue']);
  });

  it('excludes words from a different category', () => {
    const words: DyadCustomWord[] = [{ word: 'run', category: 'action', is_preference_pointer: false }];
    expect(mergeDyadWords(['park', 'zoo'], words, 'topic')).toEqual(['park', 'zoo']);
  });

  it('never mutates the base vocab array', () => {
    const base = ['park'];
    mergeDyadWords(base, [{ word: 'bob', category: 'topic', is_preference_pointer: false }], 'topic');
    expect(base).toEqual(['park']); // unchanged — no shared-state leakage risk
  });
});

describe('lookupDyadWord', () => {
  const fakeRetriever = {
    lookup: (w: string) => (w === 'park' ? { name: 'park', category: 'topic', image_url: '/park.svg' } : null),
  } as any;

  it('prefers the shared corpus when the word exists there', () => {
    const result = lookupDyadWord(fakeRetriever, 'park', []);
    expect(result).toEqual({ name: 'park', category: 'topic', image_url: '/park.svg' });
  });

  it("falls back to the dyad's custom words when the shared corpus doesn't recognize the word — the exact gotcha this exists to prevent", () => {
    const words: DyadCustomWord[] = [{ word: 'bob', category: 'topic', is_preference_pointer: false, image_data: 'ZmFrZQ==', emoji: '🙂' }];
    const result = lookupDyadWord(fakeRetriever, 'bob', words);
    expect(result?.name).toBe('bob');
    expect(result?.image_url).toBe('data:image/png;base64,ZmFrZQ==');
    expect(result?.emoji).toBe('🙂');
  });

  it('returns null when the word is in neither the shared corpus nor the custom words — genuinely hallucinated', () => {
    const result = lookupDyadWord(fakeRetriever, 'nonexistent', []);
    expect(result).toBeNull();
  });

  it('is case-insensitive for custom word lookup, matching the shared corpus behavior', () => {
    const words: DyadCustomWord[] = [{ word: 'Bob', category: 'topic', is_preference_pointer: false }];
    const result = lookupDyadWord(fakeRetriever, 'bob', words);
    expect(result?.name).toBe('Bob');
  });
});
