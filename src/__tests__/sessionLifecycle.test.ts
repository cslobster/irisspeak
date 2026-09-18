import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  ensureSchema: vi.fn(),
  sql: vi.fn(),
}));

vi.mock('@/lib/gemini', () => ({
  chat: vi.fn(),
}));

import { startSession, endSession, abortSession } from '@/lib/moderator';
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
  locale: 'en',
};

beforeEach(() => {
  vi.resetAllMocks();
  mockEnsureSchema.mockResolvedValue(undefined);
});

describe('startSession', () => {
  it('serves the static initial guides from staticData.ts (no LLM call)', async () => {
    mockSql.mockImplementation(() => Promise.resolve([]));
    mockSql.mockImplementationOnce(() =>
      Promise.resolve([{ dyad_id: fakeDyad.id, status: 'initial', topic_category: 'recall' }]),
    );

    const result = await startSession('session-1', fakeDyad as any);

    expect(mockChat).not.toHaveBeenCalled();
    expect(result.recommendation.guides.length).toBeGreaterThan(0);
    // Confirms the inlined guides are returned and {child_name} is substituted.
    expect(result.recommendation.guides.some((g) => g.guide.includes('Sammy'))).toBe(true);
  });

  it('throws forbidden when the session belongs to a different dyad', async () => {
    mockSql.mockResolvedValueOnce([{ dyad_id: 'someone-else', status: 'initial', topic_category: 'plan' }]);
    await expect(startSession('session-1', fakeDyad as any)).rejects.toThrow('forbidden');
  });

  it('throws not found when the session does not exist', async () => {
    mockSql.mockResolvedValueOnce([]);
    await expect(startSession('missing-session', fakeDyad as any)).rejects.toThrow('session not found');
  });
});

describe('endSession', () => {
  it('generates a best-effort AI title when the dialogue is non-empty', async () => {
    mockSql.mockImplementation(() => Promise.resolve([]));
    mockSql.mockImplementationOnce(() =>
      Promise.resolve([{ role: 'parent', content: 'hi', content_type: 'text', timestamp: 1, turn_id: 't1' }]),
    );
    mockChat.mockResolvedValue('A day at the park');

    await endSession('session-1', fakeDyad as any);

    expect(mockChat).toHaveBeenCalledTimes(1);
  });

  it('skips the LLM call and still terminates the session when the dialogue is empty', async () => {
    mockSql.mockResolvedValue([]);

    await endSession('session-1', fakeDyad as any);

    expect(mockChat).not.toHaveBeenCalled();
  });

  it('never throws even when the title generation call fails', async () => {
    mockSql.mockImplementation(() => Promise.resolve([]));
    mockSql.mockImplementationOnce(() =>
      Promise.resolve([{ role: 'parent', content: 'hi', content_type: 'text', timestamp: 1, turn_id: 't1' }]),
    );
    mockChat.mockRejectedValue(new Error('gemini down'));

    await expect(endSession('session-1', fakeDyad as any)).resolves.toBeUndefined();
  });
});

describe('abortSession', () => {
  it('deletes the session', async () => {
    mockSql.mockResolvedValue([]);
    await expect(abortSession('session-1', fakeDyad as any)).resolves.toBeUndefined();
    expect(mockSql).toHaveBeenCalledTimes(1);
  });
});
