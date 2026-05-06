import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  ensureSchema: vi.fn(),
  sql: vi.fn(),
}));

vi.mock('@/lib/gemini', () => ({
  chat: vi.fn(),
  stripFence: (s: string) => s,
}));

import { requestParentExample } from '@/lib/moderator';
import { sql, ensureSchema } from '@/lib/db';
import { chat } from '@/lib/gemini';

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;
const mockChat = chat as unknown as ReturnType<typeof vi.fn>;
const mockEnsureSchema = ensureSchema as unknown as ReturnType<typeof vi.fn>;

const fakeDyad = {
  id: 'dyad-1',
  alias: 'test',
  child_name: 'Sammy',
  child_gender: 'girl',
  parent_type: 'mother',
  locale: 'en',
};

const fakeGuides = [
  { id: 'static-plan-0', category: 'intention', guide: 'Ask what Sammy wants', type: 'messaging', is_generated: false },
  { id: 'static-plan-1', category: 'choice', guide: 'Offer two options', type: 'messaging', is_generated: false },
];

beforeEach(() => {
  vi.resetAllMocks();
  mockEnsureSchema.mockResolvedValue(undefined);
});

describe('requestParentExample', () => {
  it('returns an example utterance for a valid recommendation and guide', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 'rec-1', guides: fakeGuides }])
      .mockResolvedValueOnce([]);

    mockChat.mockResolvedValue('What would you like to do?');

    const result = await requestParentExample('session-1', fakeDyad as any, 'rec-1', 'static-plan-0');

    expect(result.message).toBe('What would you like to do?');
    expect(result.recommendation_id).toBe('rec-1');
    expect(result.guide_id).toBe('static-plan-0');
    expect(result.id).toBeDefined();
  });

  it('throws when recommendation is not found', async () => {
    mockSql.mockResolvedValueOnce([]);

    await expect(
      requestParentExample('session-1', fakeDyad as any, 'bad-rec-id', 'static-plan-0')
    ).rejects.toThrow('recommendation not found');
  });

  it('throws when guide_id does not exist in recommendation', async () => {
    mockSql.mockResolvedValueOnce([{ id: 'rec-1', guides: fakeGuides }]);

    await expect(
      requestParentExample('session-1', fakeDyad as any, 'rec-1', 'nonexistent-guide-id')
    ).rejects.toThrow('guide not in recommendation');
  });

  it('propagates Gemini errors as thrown exceptions', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 'rec-1', guides: fakeGuides }])
      .mockResolvedValueOnce([]);

    mockChat.mockRejectedValue(new Error('401 Invalid API key'));

    await expect(
      requestParentExample('session-1', fakeDyad as any, 'rec-1', 'static-plan-0')
    ).rejects.toThrow('401 Invalid API key');
  });
});
