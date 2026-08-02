import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  ensureSchema: vi.fn(),
  sql: vi.fn(),
}));

vi.mock('@/lib/gemini', async () => {
  const actual = await vi.importActual<typeof import('@/lib/gemini')>('@/lib/gemini');
  return {
    ...actual,
    chat: vi.fn(),
  };
});

vi.mock('@/lib/corpus', async () => {
  const actual = await vi.importActual<typeof import('@/lib/corpus')>('@/lib/corpus');
  return {
    ...actual,
    getCorpusRetriever: vi.fn().mockResolvedValue({
      wordsByCategory: vi.fn().mockReturnValue([]),
      // Every word the LLM "picked" resolves cleanly — these tests are about pool pagination,
      // not corpus-matching edge cases (already covered by cardRegen.test.ts).
      lookup: vi.fn((w: string) => ({ name: w, category: 'topic', image_url: null })),
    }),
  };
});

vi.mock('@/lib/staticData', () => ({
  EMOTION_LABELS: ['happy', 'sad'],
  TOPIC_DESCRIPTION: { plan: 'planning', recall: 'recalling', free: 'free topic' },
  loadEmotionCards: () => [],
  loadCoreCards: () => [],
  loadFolderCards: () => [
    { path: 'numbers', label: 'Numbers', icon: '/symbols/mulberry/count_,_to.svg', words: ['one', 'two', 'three'], triggers: ['how old', 'your age', 'what age'] },
  ],
  buildInitialGuides: () => [],
}));

import { refreshChildCards } from '@/lib/moderator';
import { sql, ensureSchema } from '@/lib/db';
import { chat } from '@/lib/gemini';
import { getCorpusRetriever } from '@/lib/corpus';

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;
const mockChat = chat as unknown as ReturnType<typeof vi.fn>;
const mockEnsureSchema = ensureSchema as unknown as ReturnType<typeof vi.fn>;
const mockGetCorpusRetriever = getCorpusRetriever as unknown as ReturnType<typeof vi.fn>;

const fakeDyad = {
  id: 'dyad-1', alias: 'test', child_name: 'Sammy',
  child_gender: 'girl' as const, locale: 'en' as const,
};

const t = (n: number) => Array.from({ length: n }, (_, i) => `t${i + 1}`);
const a = (n: number) => Array.from({ length: n }, (_, i) => `a${i + 1}`);
const yamlResponse = (topics: string[], actions: string[], folder?: string) =>
  `topics: [${topics.join(', ')}]\nactions: [${actions.join(', ')}]` + (folder ? `\nfolder: [${folder}]` : '');

// Builds a minimal cards[] shape sufficient for seenLabels' `category`/`corpus_name` read.
function seenCards(topics: string[], actions: string[]) {
  return [
    ...topics.map((w) => ({ category: 'topic', corpus_name: w, label: w })),
    ...actions.map((w) => ({ category: 'action', corpus_name: w, label: w })),
  ];
}

beforeEach(() => {
  vi.resetAllMocks();
  mockEnsureSchema.mockResolvedValue(undefined);
  mockGetCorpusRetriever.mockResolvedValue({
    wordsByCategory: vi.fn().mockReturnValue([]),
    lookup: vi.fn((w: string) => ({ name: w, category: 'topic', image_url: null })),
  });
});

// SQL sequence for refreshChildCards → generateChildCards. Order: 1 getCurrentTurn, 2 session,
// 3 getInterimCards, 4 getDialogue, 5 allPrevRecs (cards+pool), 6 dyad_custom_word, 7 insert —
// always 7 calls, whether or not this particular call ends up invoking chat().
function mockSequence(opts: { dialogue?: any[]; prevRecs?: any[] }) {
  mockSql
    .mockResolvedValueOnce([{ id: 'turn-child-1', role: 'child', ended_timestamp: null }])
    .mockResolvedValueOnce([{ topic_category: 'plan', subtopic: null, subtopic_description: null }])
    .mockResolvedValueOnce([{ cards: [] }])
    .mockResolvedValueOnce(opts.dialogue ?? [])
    .mockResolvedValueOnce(opts.prevRecs ?? [])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce(undefined);
}

describe('card pool — deterministic refresh pagination', () => {
  it('shows ranked 1-4 on first generation, then ranked 5-8 on refresh with zero extra chat() calls', async () => {
    mockChat.mockResolvedValueOnce(yamlResponse(t(12), a(12)));
    mockSequence({});

    const first = await refreshChildCards('sess-1', fakeDyad);
    const firstTopics = first.cards.filter(c => c.category === 'topic' && !c.is_folder).map(c => c.corpus_name);
    const firstActions = first.cards.filter(c => c.category === 'action').map(c => c.corpus_name);
    expect(firstTopics).toEqual(['t1', 't2', 't3', 't4']);
    expect(firstActions).toEqual(['a1', 'a2', 'a3', 'a4']);
    expect(mockChat).toHaveBeenCalledTimes(1);

    // The pool persisted by the first call — reused as the seed for the refresh below.
    const pool = { topics: t(12), actions: a(12), folderPaths: [], showAgeCard: false, smallTalk: 'none' as const };
    mockSequence({ prevRecs: [{ cards: seenCards(firstTopics, firstActions), pool }] });

    const second = await refreshChildCards('sess-1', fakeDyad);
    const secondTopics = second.cards.filter(c => c.category === 'topic' && !c.is_folder).map(c => c.corpus_name);
    const secondActions = second.cards.filter(c => c.category === 'action').map(c => c.corpus_name);
    expect(secondTopics).toEqual(['t5', 't6', 't7', 't8']);
    expect(secondActions).toEqual(['a5', 'a6', 'a7', 'a8']);
    // Still just the one chat() call from the very first generation — the refresh paged
    // through the pre-ranked pool instead of calling the LLM again.
    expect(mockChat).toHaveBeenCalledTimes(1);
  });

  it('falls back to exactly one more chat() call once the pool is exhausted', async () => {
    // All 12 ranked topics/actions already shown across prior batches this turn.
    const pool = { topics: t(12), actions: a(12), folderPaths: [], showAgeCard: false, smallTalk: 'none' as const };
    mockChat.mockResolvedValueOnce(yamlResponse(['nt1', 'nt2', 'nt3', 'nt4', 'nt5', 'nt6'], ['na1', 'na2', 'na3', 'na4', 'na5', 'na6']));
    mockSequence({ prevRecs: [{ cards: seenCards(t(12), a(12)), pool }] });

    const result = await refreshChildCards('sess-1', fakeDyad);

    expect(mockChat).toHaveBeenCalledTimes(1);
    const topics = result.cards.filter(c => c.category === 'topic' && !c.is_folder).map(c => c.corpus_name);
    expect(topics).toEqual(['nt1', 'nt2', 'nt3', 'nt4']);
  });

  it('decides a folder card once and freezes it across a later refresh that still needs to top up the pool', async () => {
    // Call 1: dialogue asks an age question → keyword backstop picks "numbers"; pool starts
    // shallow (8 topics/8 actions, just under MIN_POOL_DEPTH's implied 2-batch depth) so a
    // second refresh will need a top-up.
    const shallowPool = { topics: t(6), actions: a(6), folderPaths: ['numbers'], showAgeCard: false, smallTalk: 'none' as const };

    // First call already has a decided folder + a pool just deep enough to need topping up on
    // the *next* refresh (topics/actions down to 2 unseen after a first display batch of 4... to
    // keep this deterministic, seed prevRecs as if one batch of 4/4 was already shown).
    mockChat.mockResolvedValueOnce(yamlResponse(['nt1', 'nt2', 'nt3', 'nt4'], ['na1', 'na2', 'na3', 'na4']));
    // No folder line this time, and dialogue no longer mentions age — proves the folder is
    // frozen from the pool, not re-decided from this call's (folder-less) chat response.
    mockSequence({
      dialogue: [{ role: 'parent', content: 'What do you want to eat?', content_type: 'text', timestamp: 2, turn_id: 't2' }],
      prevRecs: [{ cards: [...seenCards(t(6), a(6))], pool: shallowPool }],
    });

    const result = await refreshChildCards('sess-1', fakeDyad);

    expect(mockChat).toHaveBeenCalledTimes(1); // topped up once, as expected
    const folderCard = result.cards.find(c => c.is_folder);
    expect(folderCard?.folder_path).toBe('numbers'); // frozen from the pool, not re-decided
  });

  it('falls back to repeating an already-shown word rather than returning fewer cards once the ENTIRE category vocab is exhausted', async () => {
    // Regression test: the `action` category in the real corpus is only ~39 words — a handful
    // of refreshes exhausts it completely within one turn. Before this fix, once every word had
    // been shown once, takeNext's seenLabels-filtered fallback found nothing left and silently
    // returned fewer cards each refresh (down to zero) — this is the "refresh just stops
    // working after a while" bug. A 2-word vocab makes the exhaustion trivial to trigger here.
    mockGetCorpusRetriever.mockResolvedValue({
      wordsByCategory: (cat: string) => (cat === 'action' ? ['a1', 'a2'] : []),
      lookup: (w: string) => ['a1', 'a2'].includes(w) ? { name: w, category: 'action', image_url: null } : null,
    });
    // Both action words already shown this turn — genuinely nothing new left, in the pool or the vocab.
    const pool = { topics: t(12), actions: ['a1', 'a2'], folderPaths: [], showAgeCard: false, smallTalk: 'none' as const };
    mockChat.mockResolvedValueOnce(yamlResponse(t(6), ['a1', 'a2'])); // LLM has nothing new to offer either
    mockSequence({ prevRecs: [{ cards: seenCards([], ['a1', 'a2']), pool }] });

    const result = await refreshChildCards('sess-1', fakeDyad);

    const actions = result.cards.filter(c => c.category === 'action').map(c => c.corpus_name);
    // Both words come back (repeated) instead of an empty/short action column.
    expect(actions.sort()).toEqual(['a1', 'a2']);
  });
});
