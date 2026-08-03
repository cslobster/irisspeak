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
      lookup: vi.fn((w: string) => ({ name: w, category: 'topic', image_url: null })),
    }),
  };
});

vi.mock('@/lib/staticData', () => ({
  EMOTION_LABELS: ['happy', 'sad'],
  TOPIC_DESCRIPTION: { plan: 'planning', recall: 'recalling', free: 'free topic' },
  loadEmotionCards: () => [],
  loadCoreCards: () => [
    { id: 'yes', label: 'Yes', category: 'core' },
    { id: 'no', label: 'No', category: 'core' },
  ],
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

const dyadWithAge = {
  id: 'dyad-1', alias: 'test', child_name: 'Sammy', age: 7,
  child_gender: 'girl' as const, locale: 'en' as const,
};
const dyadNoAge = {
  id: 'dyad-2', alias: 'test2', child_name: 'Jamie',
  child_gender: 'boy' as const, locale: 'en' as const,
};

beforeEach(() => {
  vi.resetAllMocks();
  mockEnsureSchema.mockResolvedValue(undefined);
  mockGetCorpusRetriever.mockResolvedValue({
    wordsByCategory: vi.fn().mockReturnValue([]),
    lookup: vi.fn((w: string) => ({ name: w, category: 'topic', image_url: null })),
  });
});

// SQL sequence for refreshChildCards → generateChildCards (see cardPool.test.ts for the full
// call-order rationale) — always 7 calls regardless of whether chat() fires this call.
function mockSequence(opts: { dialogue?: any[]; prevRecs?: any[] } = {}) {
  mockSql
    .mockResolvedValueOnce([{ id: 'turn-child-1', role: 'child', ended_timestamp: null }])
    .mockResolvedValueOnce([{ topic_category: 'plan', subtopic: null, subtopic_description: null }])
    .mockResolvedValueOnce([{ cards: [] }])
    .mockResolvedValueOnce(opts.dialogue ?? [])
    .mockResolvedValueOnce(opts.prevRecs ?? [])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce(undefined);
}

describe('identity cards — name (permanent) and age (triggered)', () => {
  it(`always includes an "I'm X" core card, regardless of message content`, async () => {
    mockChat.mockResolvedValueOnce('topics: [a, b, c, d]\nactions: [e, f, g, h]');
    mockSequence({ dialogue: [{ role: 'parent', content: 'How was school today?', content_type: 'text', timestamp: 1, turn_id: 't1' }] });

    const result = await refreshChildCards('sess-1', dyadWithAge);

    const nameCard = result.cards.find(c => c.category === 'core' && c.label === "I'm Sammy");
    expect(nameCard).toBeDefined();
  });

  it('personalizes the name card per dyad', async () => {
    mockChat.mockResolvedValueOnce('topics: [a, b, c, d]\nactions: [e, f, g, h]');
    mockSequence({});

    const result = await refreshChildCards('sess-1', dyadNoAge);

    expect(result.cards.some(c => c.category === 'core' && c.label === "I'm Jamie")).toBe(true);
  });

  it('shows a direct "I\'m 7 years old" card when age is known and the message asks to introduce yourself', async () => {
    mockChat.mockResolvedValueOnce('topics: [a, b, c, d]\nactions: [e, f, g, h]');
    mockSequence({ dialogue: [{ role: 'parent', content: 'Can you introduce yourself?', content_type: 'text', timestamp: 1, turn_id: 't1' }] });

    const result = await refreshChildCards('sess-1', dyadWithAge);

    const ageCard = result.cards.find(c => c.category === 'topic' && c.corpus_name === 'age');
    expect(ageCard?.label).toBe("I'm 7 years old");
  });

  it('also shows the direct age card for the existing "how old are you" phrasing (alongside the Numbers folder)', async () => {
    mockChat.mockResolvedValueOnce('topics: [a, b, c, d]\nactions: [e, f, g, h]');
    mockSequence({ dialogue: [{ role: 'parent', content: 'How old are you?', content_type: 'text', timestamp: 1, turn_id: 't1' }] });

    const result = await refreshChildCards('sess-1', dyadWithAge);

    expect(result.cards.some(c => c.corpus_name === 'age')).toBe(true);
    expect(result.cards.some(c => c.is_folder && c.folder_path === 'numbers')).toBe(true);
  });

  it('does NOT show an age card when the dyad has no age on file, even for an intro question', async () => {
    mockChat.mockResolvedValueOnce('topics: [a, b, c, d]\nactions: [e, f, g, h]');
    mockSequence({ dialogue: [{ role: 'parent', content: 'Tell me about yourself', content_type: 'text', timestamp: 1, turn_id: 't1' }] });

    const result = await refreshChildCards('sess-1', dyadNoAge);

    expect(result.cards.some(c => c.corpus_name === 'age')).toBe(false);
  });

  it('does NOT show an age card for an unrelated question, even when age is known', async () => {
    mockChat.mockResolvedValueOnce('topics: [a, b, c, d]\nactions: [e, f, g, h]');
    mockSequence({ dialogue: [{ role: 'parent', content: 'What do you want to eat?', content_type: 'text', timestamp: 1, turn_id: 't1' }] });

    const result = await refreshChildCards('sess-1', dyadWithAge);

    expect(result.cards.some(c => c.corpus_name === 'age')).toBe(false);
  });

  it('freezes the age-card decision across a refresh within the same turn (no flicker)', async () => {
    mockChat.mockResolvedValueOnce(
      'topics: [t1, t2, t3, t4, t5, t6, t7, t8, t9, t10, t11, t12]\nactions: [a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12]'
    );
    mockSequence({ dialogue: [{ role: 'parent', content: 'Introduce yourself!', content_type: 'text', timestamp: 1, turn_id: 't1' }] });

    const first = await refreshChildCards('sess-1', dyadWithAge);
    expect(first.cards.some(c => c.corpus_name === 'age')).toBe(true);

    // Refresh: dialogue no longer mentions age/intro at all, and the pool still has plenty of
    // depth (no top-up needed) — the age card must still be there, frozen from the first call.
    const poolRow = { topics: Array.from({ length: 12 }, (_, i) => `t${i + 1}`), actions: Array.from({ length: 12 }, (_, i) => `a${i + 1}`), folderPaths: [], showAgeCard: true, smallTalk: 'none' as const };
    const seenCards = first.cards.filter(c => c.category === 'topic' || c.category === 'action').map(c => ({ category: c.category, corpus_name: c.corpus_name, label: c.label }));
    mockSequence({
      dialogue: [{ role: 'parent', content: 'What do you want to eat?', content_type: 'text', timestamp: 2, turn_id: 't2' }],
      prevRecs: [{ cards: seenCards, pool: poolRow }],
    });

    const second = await refreshChildCards('sess-1', dyadWithAge);
    expect(second.cards.some(c => c.corpus_name === 'age')).toBe(true);
    expect(mockChat).toHaveBeenCalledTimes(1); // no second chat() call — pool still deep enough
  });
});

describe('small talk — greeting/farewell answer cards', () => {
  it('shows a "Hi!" card (mapped to the real corpus "hello" entry) for a message-initial greeting', async () => {
    mockChat.mockResolvedValueOnce('topics: [a, b, c, d]\nactions: [e, f, g, h]');
    mockSequence({ dialogue: [{ role: 'parent', content: 'Hi Sammy!', content_type: 'text', timestamp: 1, turn_id: 't1' }] });

    const result = await refreshChildCards('sess-1', dyadWithAge);

    const card = result.cards.find(c => c.corpus_name === 'hello');
    expect(card?.label).toBe('Hi!');
  });

  it('shows a "Bye!" card (mapped to "goodbye") for a farewell', async () => {
    mockChat.mockResolvedValueOnce('topics: [a, b, c, d]\nactions: [e, f, g, h]');
    mockSequence({ dialogue: [{ role: 'parent', content: 'Okay, goodbye!', content_type: 'text', timestamp: 1, turn_id: 't1' }] });

    const result = await refreshChildCards('sess-1', dyadWithAge);

    const card = result.cards.find(c => c.corpus_name === 'goodbye');
    expect(card?.label).toBe('Bye!');
  });

  it('does NOT trigger on a message that merely mentions "hi" mid-sentence (anchored at message start)', async () => {
    mockChat.mockResolvedValueOnce('topics: [a, b, c, d]\nactions: [e, f, g, h]');
    mockSequence({ dialogue: [{ role: 'parent', content: 'Did you say hi to your teacher?', content_type: 'text', timestamp: 1, turn_id: 't1' }] });

    const result = await refreshChildCards('sess-1', dyadWithAge);

    expect(result.cards.some(c => c.corpus_name === 'hello' || c.corpus_name === 'goodbye')).toBe(false);
  });

  it('shows neither greeting nor farewell for an unrelated message', async () => {
    mockChat.mockResolvedValueOnce('topics: [a, b, c, d]\nactions: [e, f, g, h]');
    mockSequence({ dialogue: [{ role: 'parent', content: 'What do you want to eat?', content_type: 'text', timestamp: 1, turn_id: 't1' }] });

    const result = await refreshChildCards('sess-1', dyadWithAge);

    expect(result.cards.some(c => c.corpus_name === 'hello' || c.corpus_name === 'goodbye')).toBe(false);
  });

  it('freezes the small-talk decision across a refresh within the same turn', async () => {
    mockChat.mockResolvedValueOnce(
      'topics: [t1, t2, t3, t4, t5, t6, t7, t8, t9, t10, t11, t12]\nactions: [a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12]'
    );
    mockSequence({ dialogue: [{ role: 'parent', content: 'Hello there!', content_type: 'text', timestamp: 1, turn_id: 't1' }] });

    const first = await refreshChildCards('sess-1', dyadWithAge);
    expect(first.cards.some(c => c.corpus_name === 'hello')).toBe(true);

    const poolRow = { topics: Array.from({ length: 12 }, (_, i) => `t${i + 1}`), actions: Array.from({ length: 12 }, (_, i) => `a${i + 1}`), folderPaths: [], showAgeCard: false, smallTalk: 'hi' as const };
    const seenCards = first.cards.filter(c => c.category === 'topic' || c.category === 'action').map(c => ({ category: c.category, corpus_name: c.corpus_name, label: c.label }));
    mockSequence({
      dialogue: [{ role: 'parent', content: 'What do you want to eat?', content_type: 'text', timestamp: 2, turn_id: 't2' }],
      prevRecs: [{ cards: seenCards, pool: poolRow }],
    });

    const second = await refreshChildCards('sess-1', dyadWithAge);
    expect(second.cards.some(c => c.corpus_name === 'hello')).toBe(true);
    expect(mockChat).toHaveBeenCalledTimes(1);
  });

  it('shows a "Thank you!" card (mapped to "thank you") for a compliment', async () => {
    mockChat.mockResolvedValueOnce('topics: [a, b, c, d]\nactions: [e, f, g, h]');
    mockSequence({ dialogue: [{ role: 'parent', content: 'Great job today!', content_type: 'text', timestamp: 1, turn_id: 't1' }] });

    const result = await refreshChildCards('sess-1', dyadWithAge);

    const card = result.cards.find(c => c.corpus_name === 'thank you');
    expect(card?.label).toBe('Thank you!');
  });

  it('shows a "Thank you!" card for an everyday appearance/belongings compliment ("Nice shoes!")', async () => {
    mockChat.mockResolvedValueOnce('topics: [a, b, c, d]\nactions: [e, f, g, h]');
    mockSequence({ dialogue: [{ role: 'parent', content: 'Nice shoes!', content_type: 'text', timestamp: 1, turn_id: 't1' }] });

    const result = await refreshChildCards('sess-1', dyadWithAge);

    const card = result.cards.find(c => c.corpus_name === 'thank you');
    expect(card?.label).toBe('Thank you!');
  });

  it('shows a "Thank you!" card for "I like your shirt" and "You look great" phrasing', async () => {
    mockChat.mockResolvedValueOnce('topics: [a, b, c, d]\nactions: [e, f, g, h]');
    mockSequence({ dialogue: [{ role: 'parent', content: 'I like your shirt today', content_type: 'text', timestamp: 1, turn_id: 't1' }] });

    const result = await refreshChildCards('sess-1', dyadWithAge);

    expect(result.cards.some(c => c.corpus_name === 'thank you')).toBe(true);
  });

  it('shows only one small-talk card even if a message could plausibly match more than one trigger', async () => {
    mockChat.mockResolvedValueOnce('topics: [a, b, c, d]\nactions: [e, f, g, h]');
    // Starts with a greeting AND contains a compliment phrase — greeting wins (checked first).
    mockSequence({ dialogue: [{ role: 'parent', content: 'Hi! Great job today!', content_type: 'text', timestamp: 1, turn_id: 't1' }] });

    const result = await refreshChildCards('sess-1', dyadWithAge);

    const smallTalkCards = result.cards.filter(c => ['hello', 'goodbye', 'thank you'].includes(c.corpus_name || ''));
    expect(smallTalkCards).toHaveLength(1);
    expect(smallTalkCards[0].corpus_name).toBe('hello');
  });
});

describe('small talk — wellbeing answer cards', () => {
  it('shows a "Good!"/"Bad!" pair for "How was your day?"', async () => {
    mockChat.mockResolvedValueOnce('topics: [a, b, c, d]\nactions: [e, f, g, h]');
    mockSequence({ dialogue: [{ role: 'parent', content: 'How was your day?', content_type: 'text', timestamp: 1, turn_id: 't1' }] });

    const result = await refreshChildCards('sess-1', dyadWithAge);

    expect(result.cards.some(c => c.corpus_name === 'good' && c.label === 'Good!')).toBe(true);
    expect(result.cards.some(c => c.corpus_name === 'bad' && c.label === 'Bad!')).toBe(true);
  });

  it('also triggers on "How are you doing?" and "How\'s it going?" phrasing', async () => {
    mockChat.mockResolvedValueOnce('topics: [a, b, c, d]\nactions: [e, f, g, h]');
    mockSequence({ dialogue: [{ role: 'parent', content: "How are you doing today?", content_type: 'text', timestamp: 1, turn_id: 't1' }] });

    const result = await refreshChildCards('sess-1', dyadWithAge);

    expect(result.cards.some(c => c.corpus_name === 'good')).toBe(true);
    expect(result.cards.some(c => c.corpus_name === 'bad')).toBe(true);
  });

  it('generalizes beyond "day" — triggers on "How was your trip to the park?"', async () => {
    mockChat.mockResolvedValueOnce('topics: [a, b, c, d]\nactions: [e, f, g, h]');
    mockSequence({ dialogue: [{ role: 'parent', content: 'How was your trip to the park?', content_type: 'text', timestamp: 1, turn_id: 't1' }] });

    const result = await refreshChildCards('sess-1', dyadWithAge);

    expect(result.cards.some(c => c.corpus_name === 'good')).toBe(true);
    expect(result.cards.some(c => c.corpus_name === 'bad')).toBe(true);
  });

  it('triggers on a direct check like "Was this good?"', async () => {
    mockChat.mockResolvedValueOnce('topics: [a, b, c, d]\nactions: [e, f, g, h]');
    mockSequence({ dialogue: [{ role: 'parent', content: 'Was this good?', content_type: 'text', timestamp: 1, turn_id: 't1' }] });

    const result = await refreshChildCards('sess-1', dyadWithAge);

    expect(result.cards.some(c => c.corpus_name === 'good')).toBe(true);
    expect(result.cards.some(c => c.corpus_name === 'bad')).toBe(true);
  });

  it('does NOT trigger wellbeing on an unrelated message', async () => {
    mockChat.mockResolvedValueOnce('topics: [a, b, c, d]\nactions: [e, f, g, h]');
    mockSequence({ dialogue: [{ role: 'parent', content: 'What do you want to eat?', content_type: 'text', timestamp: 1, turn_id: 't1' }] });

    const result = await refreshChildCards('sess-1', dyadWithAge);

    expect(result.cards.some(c => c.corpus_name === 'good' || c.corpus_name === 'bad')).toBe(false);
  });

  it('lets a greeting win over wellbeing when both could plausibly match', async () => {
    mockChat.mockResolvedValueOnce('topics: [a, b, c, d]\nactions: [e, f, g, h]');
    // Message-initial greeting, but also asks "how are you" — greeting is checked first.
    mockSequence({ dialogue: [{ role: 'parent', content: 'Hi! How are you?', content_type: 'text', timestamp: 1, turn_id: 't1' }] });

    const result = await refreshChildCards('sess-1', dyadWithAge);

    expect(result.cards.some(c => c.corpus_name === 'hello')).toBe(true);
    expect(result.cards.some(c => c.corpus_name === 'good' || c.corpus_name === 'bad')).toBe(false);
  });

  it('freezes the wellbeing decision across a refresh within the same turn', async () => {
    mockChat.mockResolvedValueOnce(
      'topics: [t1, t2, t3, t4, t5, t6, t7, t8, t9, t10, t11, t12]\nactions: [a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12]'
    );
    mockSequence({ dialogue: [{ role: 'parent', content: 'How was your day?', content_type: 'text', timestamp: 1, turn_id: 't1' }] });

    const first = await refreshChildCards('sess-1', dyadWithAge);
    expect(first.cards.some(c => c.corpus_name === 'good')).toBe(true);

    const poolRow = { topics: Array.from({ length: 12 }, (_, i) => `t${i + 1}`), actions: Array.from({ length: 12 }, (_, i) => `a${i + 1}`), folderPaths: [], showAgeCard: false, smallTalk: 'wellbeing' as const };
    const seenCards = first.cards.filter(c => c.category === 'topic' || c.category === 'action').map(c => ({ category: c.category, corpus_name: c.corpus_name, label: c.label }));
    mockSequence({
      dialogue: [{ role: 'parent', content: 'What do you want to eat?', content_type: 'text', timestamp: 2, turn_id: 't2' }],
      prevRecs: [{ cards: seenCards, pool: poolRow }],
    });

    const second = await refreshChildCards('sess-1', dyadWithAge);
    expect(second.cards.some(c => c.corpus_name === 'good')).toBe(true);
    expect(second.cards.some(c => c.corpus_name === 'bad')).toBe(true);
    expect(mockChat).toHaveBeenCalledTimes(1);
  });
});
