/**
 * Tests for the infer-sentence feature.
 *
 * Each test simulates how a minimally-verbal autistic child actually taps AAC
 * cards — typically 2-4 cards that express a need, feeling, or response — and
 * verifies that:
 *   (a) the LLM receives the right context (prompt shape checks), and
 *   (b) the mock output is handled correctly end-to-end by inferSentenceFromCards.
 *
 * The prompt quality tests (section 2) inspect the SYSTEM prompt that gets
 * sent to the LLM, ensuring the last parent message and all card categories are
 * always present.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  ensureSchema: vi.fn(),
  sql: vi.fn(),
}));

vi.mock('@/lib/gemini', () => ({
  chat: vi.fn(),
  stripFence: (s: string) => s,
}));

vi.mock('@/lib/corpus', () => ({
  getCorpusRetriever: vi.fn().mockResolvedValue({
    matchBatch: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock('@/lib/staticData', () => ({
  EMOTION_LABELS: ['happy', 'sad', 'tired', 'scared', 'angry'],
  TOPIC_DESCRIPTION: { plan: 'planning activities', recall: 'recalling events', free: 'free topic' },
  loadEmotionCards: () => [],
  loadCoreCards: () => [],
  labelForParent: (c: any) => c?.label ?? String(c),
  buildInitialGuides: () => [],
}));

import { inferSentenceFromCards } from '@/lib/moderator';
import { sql, ensureSchema } from '@/lib/db';
import { chat } from '@/lib/gemini';
import { buildSentenceInferencePrompt } from '@/lib/prompts';
import type { CardInfo } from '@/lib/types';

const mockSql  = sql  as unknown as ReturnType<typeof vi.fn>;
const mockChat = chat as unknown as ReturnType<typeof vi.fn>;
const mockEnsureSchema = ensureSchema as unknown as ReturnType<typeof vi.fn>;

const dyad = {
  id: 'dyad-1', alias: 'test', child_name: 'Sammy',
  child_gender: 'girl' as const, parent_type: 'mother' as const, locale: 'en' as const,
};

function card(label: string, category: CardInfo['category'], corpus_name?: string): CardInfo {
  return { id: label, recommendation_id: 'rec-1', label, label_localized: label, category, corpus_name };
}

/** Set up mockSql for inferSentenceFromCards:
 *  1. getCurrentTurn → child turn
 *  2. getInterimCards → provided cards
 *  3. getDialogue     → provided dialogue rows
 */
function mockInferSequence(
  cards: CardInfo[],
  dialogueRows: { role: string; content: string; content_type: string }[] = [],
) {
  mockSql
    .mockResolvedValueOnce([{ id: 'turn-child-1', role: 'child', ended_timestamp: null }])
    .mockResolvedValueOnce(cards.length ? [{ cards }] : [])
    .mockResolvedValueOnce(dialogueRows.map((r, i) => ({ ...r, timestamp: i + 1, turn_id: 't1' })));
}

beforeEach(() => {
  vi.resetAllMocks();
  mockEnsureSchema.mockResolvedValue(undefined);
});

// ─── Section 1: End-to-end mock — inferSentenceFromCards returns LLM text ────

describe('inferSentenceFromCards — returns LLM output', () => {
  it('returns the sentence from the LLM (no quotes stripped)', async () => {
    mockInferSequence([card('pizza', 'topic')]);
    mockChat.mockResolvedValue('I want pizza');

    const result = await inferSentenceFromCards('sess-1', dyad);
    expect(result).toBe('I want pizza');
  });

  it('strips surrounding quotes if LLM wraps the sentence', async () => {
    mockInferSequence([card('cookie', 'topic')]);
    mockChat.mockResolvedValue('"I want a cookie"');

    const result = await inferSentenceFromCards('sess-1', dyad);
    expect(result).toBe('I want a cookie');
  });

  it('throws when no cards are selected', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 'turn-child-1', role: 'child', ended_timestamp: null }])
      .mockResolvedValueOnce([]);

    await expect(inferSentenceFromCards('sess-1', dyad)).rejects.toThrow('no cards selected');
  });

  it('throws when it is not the child turn', async () => {
    mockSql.mockResolvedValueOnce([{ id: 'turn-parent-1', role: 'parent', ended_timestamp: null }]);

    await expect(inferSentenceFromCards('sess-1', dyad)).rejects.toThrow('not child turn');
  });
});

// ─── Section 2: Prompt shape — last parent message is always surfaced ─────────

describe('inferSentenceFromCards — passes last parent message to prompt', () => {
  it('includes the last parent message in the system prompt', async () => {
    mockInferSequence(
      [card('pizza', 'topic')],
      [
        { role: 'parent', content: 'What do you want for lunch?', content_type: 'text' },
      ],
    );
    mockChat.mockResolvedValue('I want pizza');

    await inferSentenceFromCards('sess-1', dyad);

    const systemPrompt: string = mockChat.mock.calls[0][0][0].content;
    expect(systemPrompt).toContain('What do you want for lunch?');
  });

  it('uses the LAST parent message when there are multiple exchanges', async () => {
    mockInferSequence(
      [card('cookie', 'topic')],
      [
        { role: 'parent', content: 'First question', content_type: 'text' },
        { role: 'child',  content: JSON.stringify([card('park', 'topic')]), content_type: 'cards' },
        { role: 'parent', content: 'Are you done eating?', content_type: 'text' },
      ],
    );
    mockChat.mockResolvedValue('No, I want more cookies');

    await inferSentenceFromCards('sess-1', dyad);

    const systemPrompt: string = mockChat.mock.calls[0][0][0].content;
    expect(systemPrompt).toContain('Are you done eating?');
    expect(systemPrompt).not.toContain('First question');
  });

  it('still works without a parent message (child initiates)', async () => {
    mockInferSequence([card('hungry', 'topic')], []);
    mockChat.mockResolvedValue("I'm hungry");

    const result = await inferSentenceFromCards('sess-1', dyad);
    expect(result).toBe("I'm hungry");
  });

  it('puts the parent message in the system prompt, not the full dialogue history', async () => {
    // Regression test: passing the full dialogue transcript as the user message let the model
    // pull in words from *other* turns' card taps (e.g. inferring a previous turn's topic into
    // the current turn's sentence). The parent message is already in the system prompt (via
    // buildSentenceInferencePrompt) -- the user message must not also carry the transcript.
    mockInferSequence(
      [card('water', 'topic')],
      [
        { role: 'parent', content: 'What do you need?', content_type: 'text' },
      ],
    );
    mockChat.mockResolvedValue('I need water');

    await inferSentenceFromCards('sess-1', dyad);

    const systemContent: string = mockChat.mock.calls[0][0][0].content;
    const userContent: string = mockChat.mock.calls[0][0][1].content;
    expect(systemContent).toContain('What do you need?');
    expect(userContent).not.toContain('What do you need?');
    expect(userContent).not.toContain('<dialogue>');
  });
});

// ─── Section 3: Prompt builder — card categories and child name ───────────────

describe('buildSentenceInferencePrompt — prompt content', () => {
  it('includes child name', () => {
    const prompt = buildSentenceInferencePrompt([card('park', 'topic')], 'Sammy');
    expect(prompt).toContain('Sammy');
  });

  it('includes topic/action cards in "Content" line', () => {
    const prompt = buildSentenceInferencePrompt(
      [card('park', 'topic'), card('run', 'action')],
      'Sammy',
    );
    expect(prompt).toContain('park');
    expect(prompt).toContain('run');
  });

  it('includes emotion cards in "Feeling" line', () => {
    const prompt = buildSentenceInferencePrompt(
      [card('happy', 'emotion')],
      'Sammy',
    );
    expect(prompt).toContain('happy');
    expect(prompt).toContain('Feeling');
  });

  it('includes core cards in "Core" line', () => {
    const prompt = buildSentenceInferencePrompt(
      [card('No', 'core')],
      'Sammy',
    );
    expect(prompt).toContain('No');
    expect(prompt).toContain('Core');
  });

  it('tells the LLM to start with "I" when no core card', () => {
    const prompt = buildSentenceInferencePrompt([card('food', 'topic')], 'Sammy');
    expect(prompt).toContain('Begin with "I"');
  });

  it('tells the LLM the core card goes at the start when present', () => {
    const prompt = buildSentenceInferencePrompt([card('Yes', 'core'), card('food', 'topic')], 'Sammy');
    expect(prompt).toContain('"Yes"');
    expect(prompt).toContain('start');
  });

  it('includes the last parent message when provided', () => {
    const prompt = buildSentenceInferencePrompt(
      [card('pizza', 'topic')],
      'Sammy',
      'What do you want to eat?',
    );
    expect(prompt).toContain('What do you want to eat?');
    expect(prompt).toContain('The parent just said');
  });

  it('omits the parent context line when no last message', () => {
    const prompt = buildSentenceInferencePrompt([card('pizza', 'topic')], 'Sammy');
    expect(prompt).not.toContain('The parent just said');
  });

  it('uses corpus_name over label when available', () => {
    const c = card('hungry', 'topic');
    c.corpus_name = 'hunger';
    const prompt = buildSentenceInferencePrompt([c], 'Sammy');
    expect(prompt).toContain('hunger');
  });
});

// ─── Section 4: AAC child card-selection scenarios ────────────────────────────
//
// Each test describes a realistic AAC interaction and verifies that the
// PROMPT sent to the LLM has the right context so the model can produce
// a natural sentence (mocked output shown as a comment for reference).

describe('AAC child scenarios — prompt contains correct context', () => {
  const scenarios: Array<{
    label: string;
    parentMsg: string;
    cards: CardInfo[];
    expectedPromptContains: string[];
  }> = [
    {
      label: 'basic food request (responding to lunch question)',
      parentMsg: 'What do you want for lunch?',
      cards: [card('pizza', 'topic'), card('want', 'action')],
      // Expected LLM output: "I want pizza"
      expectedPromptContains: ['What do you want for lunch?', 'pizza', 'want'],
    },
    {
      label: 'negation: child refuses sleep',
      parentMsg: 'Time to go to sleep!',
      cards: [card('No', 'core'), card('sleep', 'action'), card('tired', 'emotion')],
      // Expected LLM output: "No, I'm too tired to sleep" or "No, I feel tired"
      expectedPromptContains: ['Time to go to sleep', 'No', 'sleep', 'tired'],
    },
    {
      label: 'affirmation with detail',
      parentMsg: 'Do you want to go to the park?',
      cards: [card('Yes', 'core'), card('swing', 'topic'), card('play', 'action')],
      // Expected LLM output: "Yes, I want to play on the swings"
      expectedPromptContains: ['park', 'Yes', 'swing', 'play'],
    },
    {
      label: 'pain report',
      parentMsg: 'Where does it hurt?',
      cards: [card('hurt', 'action'), card('stomach', 'topic'), card('help', 'core')],
      // Expected LLM output: "Help, my stomach hurts"
      expectedPromptContains: ['Where does it hurt?', 'hurt', 'stomach', 'help'],
    },
    {
      label: 'recalling a positive school memory',
      parentMsg: 'How was school today?',
      cards: [card('friend', 'topic'), card('play', 'action'), card('happy', 'emotion')],
      // Expected LLM output: "I played with a friend and felt happy"
      expectedPromptContains: ['How was school today?', 'friend', 'play', 'happy'],
    },
    {
      label: 'wanting more of something',
      parentMsg: 'Are you done with your snack?',
      cards: [card('No', 'core'), card('more', 'action'), card('cookie', 'topic')],
      // Expected LLM output: "No, I want more cookies"
      expectedPromptContains: ['Are you done', 'No', 'more', 'cookie'],
    },
    {
      label: 'child initiates — no parent context',
      parentMsg: '',
      cards: [card('go', 'action'), card('home', 'topic'), card('tired', 'emotion')],
      // Expected LLM output: "I'm tired and want to go home"
      expectedPromptContains: ['go', 'home', 'tired'],
    },
    {
      label: 'emotional distress — seeking comfort',
      parentMsg: 'What\'s wrong?',
      cards: [card('sad', 'emotion'), card('miss', 'action'), card('school', 'topic')],
      // Expected LLM output: "I feel sad, I miss school"
      expectedPromptContains: ["What's wrong?", 'sad', 'miss', 'school'],
    },
  ];

  for (const s of scenarios) {
    it(s.label, async () => {
      const dialogueRows = s.parentMsg
        ? [{ role: 'parent', content: s.parentMsg, content_type: 'text' }]
        : [];

      mockInferSequence(s.cards, dialogueRows);
      mockChat.mockResolvedValue('I want something');  // content doesn't matter for prompt checks

      await inferSentenceFromCards('sess-1', dyad);

      const systemPrompt: string = mockChat.mock.calls[0][0][0].content;
      for (const fragment of s.expectedPromptContains) {
        expect(systemPrompt, `prompt missing: "${fragment}"`).toContain(fragment);
      }
    });
  }
});
