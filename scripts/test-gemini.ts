import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import OpenAI from 'openai';

const key = process.env.GEMINI_API_KEY;
const baseURL = process.env.OPENAI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai/';
const model = process.env.LLM_MODEL || 'gemini-2.0-flash';

console.log('Key prefix:', key?.slice(0, 8) + '...');
console.log('Base URL:', baseURL);
console.log('Model:', model);

const client = new OpenAI({ apiKey: key!, baseURL });

async function main() {
  try {
    const resp = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: 'Say hello in 3 words.' }],
    });
    console.log('\nSuccess:', resp.choices[0]?.message?.content);
  } catch (e: any) {
    console.error('\nFailed:', e?.message);
    console.error('Status:', e?.status);
    console.error('Full error:', JSON.stringify(e?.error, null, 2));
  }
}

main();
