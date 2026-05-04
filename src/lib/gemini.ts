import OpenAI from 'openai';

let _client: OpenAI | null = null;

function client(): OpenAI {
  if (!_client) {
    _client = new OpenAI({
      apiKey: process.env.GEMINI_API_KEY!,
      baseURL: process.env.OPENAI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai/',
    });
  }
  return _client;
}

const MODEL = process.env.LLM_MODEL || 'gemini-2.5-flash-lite';
const FENCE_RE = /```(?:[a-zA-Z0-9_+-]*)\s*\n?([\s\S]*?)\n?\s*```/;

/** Strip a single ```yaml/```json fence wrapper if present. Gemini commonly wraps structured output. */
export function stripFence(text: string): string {
  const m = FENCE_RE.exec(text);
  return (m ? m[1] : text).trim();
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
