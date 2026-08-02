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
  // mergeDyadWords/lookupDyadWord are plain pure functions (no DB/fs access) — keep the real
  // implementations under test rather than re-mocking them, same reasoning as the gemini mock
  // below. Only getCorpusRetriever needs mocking, since it touches the filesystem.
  const actual = await vi.importActual<typeof import('@/lib/corpus')>('@/lib/corpus');
  return {
    ...actual,
    getCorpusRetriever: vi.fn().mockResolvedValue({
      wordsByCategory: vi.fn().mockReturnValue([]),
      lookup: vi.fn().mockReturnValue(null),
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
    { path: 'time', label: 'Time', icon: '/symbols/mulberry/clock.svg', words: ['today', 'tomorrow'], triggers: ['what time'] },
  ],
  buildInitialGuides: () => [],
}));

import { addChildCard, refreshChildCards } from '@/lib/moderator';
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

const existingCard = {
  id: 'card-1', recommendation_id: 'rec-1',
  label: 'park', label_localized: 'park', category: 'topic' as const,
};

const existingRecommendation = {
  id: 'rec-1', session_id: 'sess-1', turn_id: 'turn-child-1',
  cards: [existingCard], timestamp: 1000,
};

// Helper: standard mock sequence for addChildCard happy path
// SQL call order after fix:
//   1. getCurrentTurn
//   2. get rec by recommendation_id (card lookup)
//   3. appendInterimCard: atomic INSERT ... ON CONFLICT ... RETURNING cards
//   4. SELECT * child_card_recommendation (return existing rec)
function mockAddCardSequence(interimBefore: any[] = []) {
  mockSql
    .mockResolvedValueOnce([{ id: 'turn-child-1', role: 'child', ended_timestamp: null }])
    .mockResolvedValueOnce([{ cards: [existingCard] }])
    .mockResolvedValueOnce([{ cards: [...interimBefore, existingCard] }])
    .mockResolvedValueOnce([existingRecommendation]);
}

beforeEach(() => {
  vi.resetAllMocks();
  mockEnsureSchema.mockResolvedValue(undefined);
  mockChat.mockResolvedValue('topics: [a, b, c, d]\nactions: [e, f, g, h]\nemotions: [happy, sad, happy, sad]');
  mockGetCorpusRetriever.mockResolvedValue({
    wordsByCategory: vi.fn().mockReturnValue([]),
    lookup: vi.fn().mockReturnValue(null),
  });
});

// ─── Behavior 1: No auto-regen on card tap ───────────────────────────────────

describe('addChildCard — no auto-regen', () => {
  it('does NOT call the LLM when a card is tapped', async () => {
    mockAddCardSequence();

    await addChildCard('sess-1', fakeDyad, { id: 'card-1', recommendation_id: 'rec-1' });

    expect(mockChat).not.toHaveBeenCalled();
  });

  it('returns the existing recommendation unchanged as new_recommendation', async () => {
    mockAddCardSequence();

    const result = await addChildCard('sess-1', fakeDyad, { id: 'card-1', recommendation_id: 'rec-1' });

    expect(result.new_recommendation.id).toBe('rec-1');
    expect(result.new_recommendation.cards).toEqual([existingCard]);
  });

  it('still persists the card to interim selection', async () => {
    mockAddCardSequence();

    const result = await addChildCard('sess-1', fakeDyad, { id: 'card-1', recommendation_id: 'rec-1' });

    expect(result.interim_cards).toContainEqual(existingCard);
  });
});

// ─── Behavior 2: Explicit refresh uses ALL previously seen cards ──────────────

describe('refreshChildCards — comprehensive seen-cards exclusion', () => {
  // SQL call order for refreshChildCards after fix:
  //   refreshChildCards: 1.getCurrentTurn  2.session  3.getInterimCards
  //   generateChildCards: 4.getDialogue  5.allPrevRecs  6.insert

  it('calls the LLM when refresh is triggered', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 'turn-child-1', role: 'child', ended_timestamp: null }]) // 1
      .mockResolvedValueOnce([{ topic_category: 'plan', subtopic: null, subtopic_description: null }]) // 2
      .mockResolvedValueOnce([{ cards: [] }])      // 3 getInterimCards
      .mockResolvedValueOnce([])                   // 4 getDialogue
      .mockResolvedValueOnce([])                   // 5 allPrevRecs (empty — first ever)
      .mockResolvedValueOnce([])                   // 6 dyad_custom_word
      .mockResolvedValueOnce(undefined);            // 7 insert

    await refreshChildCards('sess-1', fakeDyad);

    expect(mockChat).toHaveBeenCalledTimes(1);
  });

  it('includes ALL previously seen topic/action labels in the avoid list, not just the last rec', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 'turn-child-1', role: 'child', ended_timestamp: null }]) // 1
      .mockResolvedValueOnce([{ topic_category: 'plan', subtopic: null, subtopic_description: null }]) // 2
      .mockResolvedValueOnce([{ cards: [] }])       // 3 interimCards
      .mockResolvedValueOnce([])                    // 4 dialogue
      .mockResolvedValueOnce([                      // 5 allPrevRecs — 2 recs
        { cards: [{ label: 'park', category: 'topic' }, { label: 'run',  category: 'action' }] },
        { cards: [{ label: 'zoo',  category: 'topic' }, { label: 'swim', category: 'action' }] },
      ])
      .mockResolvedValueOnce([])                    // 6 dyad_custom_word
      .mockResolvedValueOnce(undefined);            // 7 insert

    await refreshChildCards('sess-1', fakeDyad);

    const systemPrompt: string = mockChat.mock.calls[0][0][0].content;
    expect(systemPrompt).toContain('park');
    expect(systemPrompt).toContain('run');
    expect(systemPrompt).toContain('zoo');
    expect(systemPrompt).toContain('swim');
  });

  it('passes the full dialogue (not just last message) as context', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 'turn-child-1', role: 'child', ended_timestamp: null }]) // 1
      .mockResolvedValueOnce([{ topic_category: 'plan', subtopic: null, subtopic_description: null }]) // 2
      .mockResolvedValueOnce([{ cards: [] }])       // 3 interimCards
      .mockResolvedValueOnce([                      // 4 dialogue — two full exchanges
        { role: 'parent', content: 'first message',  content_type: 'text', timestamp: 1, turn_id: 't1' },
        { role: 'child',  content: JSON.stringify([{ label: 'park' }]), content_type: 'cards', timestamp: 2, turn_id: 't2' },
        { role: 'parent', content: 'second message', content_type: 'text', timestamp: 3, turn_id: 't3' },
      ])
      .mockResolvedValueOnce([])                    // 5 allPrevRecs
      .mockResolvedValueOnce([])                    // 6 dyad_custom_word
      .mockResolvedValueOnce(undefined);            // 7 insert

    await refreshChildCards('sess-1', fakeDyad);

    const userContent: string = mockChat.mock.calls[0][0][1].content;
    expect(userContent).toContain('first message');
    expect(userContent).toContain('second message');
  });
});

// ─── Behavior 3: Optional folder card (e.g. "Numbers") ───────────────────────

describe('generateChildCards — folder card suggestion', () => {
  function mockRefreshSequence() {
    mockSql
      .mockResolvedValueOnce([{ id: 'turn-child-1', role: 'child', ended_timestamp: null }]) // 1 getCurrentTurn
      .mockResolvedValueOnce([{ topic_category: 'plan', subtopic: null, subtopic_description: null }]) // 2 session
      .mockResolvedValueOnce([{ cards: [] }]) // 3 getInterimCards
      .mockResolvedValueOnce([]) // 4 dialogue
      .mockResolvedValueOnce([]) // 5 allPrevRecs
      .mockResolvedValueOnce([]) // 6 dyad_custom_word
      .mockResolvedValueOnce(undefined); // 7 insert
  }

  it('appends a folder card when the LLM picks an allow-listed folder', async () => {
    mockChat.mockResolvedValue('topics: [a, b, c, d]\nactions: [e, f, g, h]\nfolder: [numbers]');
    mockRefreshSequence();

    const result = await refreshChildCards('sess-1', fakeDyad);

    const folderCard = result.cards.find(c => c.is_folder);
    expect(folderCard).toBeDefined();
    expect(folderCard?.folder_path).toBe('numbers');
    expect(folderCard?.label).toBe('Numbers');
  });

  it('drops a hallucinated folder name not in the allow-list', async () => {
    mockChat.mockResolvedValue('topics: [a, b, c, d]\nactions: [e, f, g, h]\nfolder: [nonexistent]');
    mockRefreshSequence();

    const result = await refreshChildCards('sess-1', fakeDyad);

    expect(result.cards.some(c => c.is_folder)).toBe(false);
  });

  it('is unaffected when no folder line is present and the message has no obvious keyword', async () => {
    mockChat.mockResolvedValue('topics: [a, b, c, d]\nactions: [e, f, g, h]');
    mockRefreshSequence();

    const result = await refreshChildCards('sess-1', fakeDyad);

    expect(result.cards.some(c => c.is_folder)).toBe(false);
  });

  it('falls back to a keyword-matched folder when the LLM omits one for an obvious case', async () => {
    // The LLM sometimes forgets to suggest a folder even for unambiguous cases like an age
    // question — the deterministic keyword backstop should still surface it.
    mockChat.mockResolvedValue('topics: [a, b, c, d]\nactions: [e, f, g, h]');
    mockSql
      .mockResolvedValueOnce([{ id: 'turn-child-1', role: 'child', ended_timestamp: null }]) // 1 getCurrentTurn
      .mockResolvedValueOnce([{ topic_category: 'plan', subtopic: null, subtopic_description: null }]) // 2 session
      .mockResolvedValueOnce([{ cards: [] }]) // 3 getInterimCards
      .mockResolvedValueOnce([ // 4 dialogue
        { role: 'parent', content: 'How old are you?', content_type: 'text', timestamp: 1, turn_id: 't1' },
      ])
      .mockResolvedValueOnce([]) // 5 allPrevRecs
      .mockResolvedValueOnce([]) // 6 dyad_custom_word
      .mockResolvedValueOnce(undefined); // 7 insert

    const result = await refreshChildCards('sess-1', fakeDyad);

    const folderCard = result.cards.find(c => c.is_folder);
    expect(folderCard?.folder_path).toBe('numbers');
  });

  it('replaces one topic slot per folder card and excludes that folder\'s own words from the topic pool', async () => {
    // "one" is in the mocked numbers folder's word list — it must not also appear loose.
    mockGetCorpusRetriever.mockResolvedValue({
      wordsByCategory: vi.fn().mockReturnValue([]),
      lookup: vi.fn((w: string) => {
        const known = ['one', 'park', 'zoo', 'home'];
        return known.includes(w) ? { name: w, category: 'topic', image_url: null } : null;
      }),
    });
    mockChat.mockResolvedValue('topics: [one, park, zoo, home]\nactions: [e, f, g, h]\nfolder: [numbers]');
    mockRefreshSequence();

    const result = await refreshChildCards('sess-1', fakeDyad);

    const topicCards = result.cards.filter(c => c.category === 'topic');
    expect(topicCards).toHaveLength(4); // 3 real words + 1 folder card, not 5
    expect(topicCards.some(c => c.corpus_name === 'one')).toBe(false); // excluded — covered by the folder
    expect(topicCards.some(c => c.is_folder)).toBe(true);
  });
});

// ─── Behavior 4: Custom Vocabulary Word (personalization core) ───────────────
// See CONTEXT.md's Custom Vocabulary Word entry — this is the exact failure mode flagged at
// design time: a word the LLM correctly picked from the vocab list it was given could get
// silently dropped by corpus.lookup()'s "reject anything hallucinated" check just because the
// shared corpus doesn't recognize it. This is a regression test for that specific gotcha, not
// just a happy-path check.

describe('generateChildCards — Custom Vocabulary Word', () => {
  function mockRefreshSequenceWithCustomWords(customWords: any[]) {
    mockSql
      .mockResolvedValueOnce([{ id: 'turn-child-1', role: 'child', ended_timestamp: null }]) // 1 getCurrentTurn
      .mockResolvedValueOnce([{ topic_category: 'plan', subtopic: null, subtopic_description: null }]) // 2 session
      .mockResolvedValueOnce([{ cards: [] }]) // 3 getInterimCards
      .mockResolvedValueOnce([]) // 4 dialogue
      .mockResolvedValueOnce([]) // 5 allPrevRecs
      .mockResolvedValueOnce(customWords) // 6 dyad_custom_word
      .mockResolvedValueOnce(undefined); // 7 insert
  }

  it("includes a dyad's custom word in the vocab list handed to the LLM", async () => {
    mockGetCorpusRetriever.mockResolvedValue({
      wordsByCategory: vi.fn().mockReturnValue([]),
      lookup: vi.fn().mockReturnValue(null),
    });
    mockChat.mockResolvedValue('topics: [a, b, c, d]\nactions: [e, f, g, h]');
    mockRefreshSequenceWithCustomWords([
      { word: 'bob', category: 'topic', is_preference_pointer: false, image_data: null, emoji: '🙂' },
    ]);

    await refreshChildCards('sess-1', fakeDyad);

    const systemPrompt: string = mockChat.mock.calls[0][0][0].content;
    expect(systemPrompt).toContain('bob');
  });

  it('does NOT silently drop a custom word the LLM picked, even though the shared corpus has never heard of it', async () => {
    // The shared corpus lookup returns null for everything — simulating a word that only
    // exists as a per-dyad Custom Vocabulary Word, not in data/corpus_vocabulary.csv.
    mockGetCorpusRetriever.mockResolvedValue({
      wordsByCategory: vi.fn().mockReturnValue([]),
      lookup: vi.fn().mockReturnValue(null),
    });
    mockChat.mockResolvedValue('topics: [bob, x, y, z]\nactions: [e, f, g, h]');
    mockRefreshSequenceWithCustomWords([
      { word: 'bob', category: 'topic', is_preference_pointer: false, image_data: null, emoji: '🙂' },
    ]);

    const result = await refreshChildCards('sess-1', fakeDyad);

    const bobCard = result.cards.find(c => c.category === 'topic' && c.corpus_name === 'bob');
    expect(bobCard).toBeDefined();
    expect(bobCard?.emoji).toBe('🙂');
  });

  it("excludes preference-pointer words from the vocab list (word already exists in the shared corpus)", async () => {
    mockGetCorpusRetriever.mockResolvedValue({
      // Category-aware, matching real wordsByCategory behavior — a mock that ignores its
      // argument would leak "red" into the action vocab too and inflate the occurrence count.
      wordsByCategory: vi.fn((cat: string) => (cat === 'topic' ? ['red'] : [])),
      lookup: vi.fn((w: string) => (w === 'red' ? { name: 'red', category: 'topic', image_url: null } : null)),
    });
    mockChat.mockResolvedValue('topics: [a, b, c, d]\nactions: [e, f, g, h]');
    mockRefreshSequenceWithCustomWords([
      { word: 'red', category: 'topic', is_preference_pointer: true, image_data: null, emoji: null },
    ]);

    await refreshChildCards('sess-1', fakeDyad);

    const systemPrompt: string = mockChat.mock.calls[0][0][0].content;
    // "red" legitimately appears twice in the full prompt by design — once in the topic
    // vocabulary list (from the base corpus) and once in the profileFacts "known favorites"
    // context (see moderator.ts). What must NOT happen is "red" appearing twice within the
    // vocab list itself, which would mean mergeDyadWords failed to exclude the pointer.
    const topicListLine = systemPrompt.match(/Topic vocabulary: ([^\n]*)/)?.[1] ?? '';
    const occurrencesInVocabList = (topicListLine.match(/\bred\b/g) || []).length;
    expect(occurrencesInVocabList).toBe(1);
    expect(systemPrompt).toContain('known favorites: red');
  });
});
