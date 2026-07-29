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

vi.mock('@/lib/corpus', () => ({
  getCorpusRetriever: vi.fn().mockResolvedValue({
    wordsByCategory: vi.fn().mockReturnValue([]),
    lookup: vi.fn().mockReturnValue(null),
  }),
}));

vi.mock('@/lib/staticData', () => ({
  EMOTION_LABELS: ['happy', 'sad'],
  TOPIC_DESCRIPTION: { plan: 'planning', recall: 'recalling', free: 'free topic' },
  loadEmotionCards: () => [],
  loadCoreCards: () => [],
  labelForParent: (c: any) => c?.label ?? String(c),
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
  child_gender: 'girl' as const, parent_type: 'mother' as const, locale: 'en' as const,
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
      .mockResolvedValueOnce(undefined);            // 6 insert

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
      .mockResolvedValueOnce(undefined);            // 6 insert

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
      .mockResolvedValueOnce(undefined);            // 6 insert

    await refreshChildCards('sess-1', fakeDyad);

    const userContent: string = mockChat.mock.calls[0][0][1].content;
    expect(userContent).toContain('first message');
    expect(userContent).toContain('second message');
  });
});
