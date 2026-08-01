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
const FENCE_RE = /```(?:[a-zA-Z0-9_+-]*)\s*\n?([\s\S]*?)\n?\s*```/;

/** Strip a single ```yaml/```json fence wrapper if present. Gemini commonly wraps structured output. */
export function stripFence(text: string): string {
  const m = FENCE_RE.exec(text);
  return (m ? m[1] : text).trim();
}

/**
 * Pull a `key: [a, b, c]` or block-list `key:\n  - a\n  - b` value out of anywhere in the
 * text, ignoring anything before/after it. Gemini occasionally writes its reasoning out as
 * prose before the requested structured output despite "output only X" instructions, which
 * breaks a strict whole-document YAML.parse — this scans for the line(s) that matter instead
 * of requiring the entire response to be valid YAML.
 */
export function extractYamlList(text: string, key: string): string[] {
  const inline = new RegExp(`^[ \\t]*${key}:[ \\t]*\\[(.*)\\][ \\t]*$`, 'm');
  const inlineMatch = inline.exec(text);
  if (inlineMatch) {
    return inlineMatch[1]
      .split(',')
      .map((s) => s.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean);
  }

  const block = new RegExp(`^[ \\t]*${key}:[ \\t]*\\r?\\n((?:[ \\t]*-[ \\t]*.+\\r?\\n?)+)`, 'm');
  const blockMatch = block.exec(text);
  if (blockMatch) {
    return blockMatch[1]
      .split(/\r?\n/)
      .map((l) => l.replace(/^[ \t]*-[ \t]*/, '').trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean);
  }

  // Fallback: a bare, bracket-less scalar (e.g. `folder: numbers` instead of the requested
  // `folder: [numbers]`) — models occasionally drop the brackets despite instructions.
  const bare = new RegExp(`^[ \\t]*${key}:[ \\t]*(.+)$`, 'm');
  const bareMatch = bare.exec(text);
  if (bareMatch) {
    const val = bareMatch[1].trim();
    if (!val.startsWith('[')) {
      return val
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    }
  }

  return [];
}

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// Every prompt in this codebase asks for a short YAML block or a single short sentence/
// utterance -- 500 tokens is generous headroom over the largest of those, and caps the
// worst case where Gemini rambles reasoning prose before the actual output (see
// extractYamlList's doc comment) instead of letting generation run unbounded.
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
