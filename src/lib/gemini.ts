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

  return [];
}

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function chat(messages: ChatTurn[], opts: { model?: string; temperature?: number } = {}): Promise<string> {
  const resp = await client().chat.completions.create({
    model: opts.model || MODEL,
    messages,
    temperature: opts.temperature,
  });
  return resp.choices[0]?.message?.content || '';
}
