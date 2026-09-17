import OpenAI from 'openai';

let _client: OpenAI | null = null;

function client(): OpenAI {
  if (!_client) {
    const openRouterKey = process.env.OPENROUTER_API_KEY;
    if (openRouterKey) {
      _client = new OpenAI({
        apiKey: openRouterKey,
        baseURL: 'https://openrouter.ai/api/v1',
      });
    } else {
      _client = new OpenAI({
        apiKey: process.env.GEMINI_API_KEY!,
        baseURL: process.env.OPENAI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai/',
      });
    }
  }
  return _client;
}

const MODEL = process.env.LLM_MODEL || (process.env.OPENROUTER_API_KEY ? 'google/gemini-2.5-flash' : 'gemini-2.5-flash-lite');

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// The one remaining prompt (session title, see prompts.ts) asks for a handful of words --
// 500 tokens is generous headroom, and caps the worst case where Gemini rambles instead of
// letting generation run unbounded.
const DEFAULT_MAX_TOKENS = 500;
// Per-request timeout well under the 60s Vercel function ceiling, so a stuck/slow call
// fails fast enough to retry within the same request instead of eating the whole budget.
const DEFAULT_TIMEOUT_MS = 20_000;

export async function chat(
  messages: ChatTurn[],
  opts: { model?: string; temperature?: number; maxTokens?: number; timeoutMs?: number } = {},
): Promise<string> {
  const params = {
    model: opts.model || MODEL,
    messages,
    temperature: opts.temperature,
    max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
  };
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const resp = await client().chat.completions.create(params, { timeout });
    return resp.choices[0]?.message?.content || '';
  } catch (e) {
    // One retry on timeout/transient failure -- covers the common case (a single slow
    // generation) without masking a genuinely broken request (which will fail the same
    // way twice and then surface to the caller).
    console.warn('[gemini] chat() failed, retrying once:', e);
    const resp = await client().chat.completions.create(params, { timeout });
    return resp.choices[0]?.message?.content || '';
  }
}
