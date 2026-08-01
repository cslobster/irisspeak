import { sql, ensureSchema } from '@/lib/db';
import { dyadFromRequest } from '@/lib/auth';
import { ok, badRequest, unauthorized } from '@/lib/responses';
import { nanoid } from 'nanoid';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Custom Vocabulary Word, parent-direct source (see CONTEXT.md) — always auto-approved,
// since deliberate parent input carries no invention risk (unlike the AI-detected source,
// which is out of scope for this pass — see docs/prd-personalization-core.md).

export async function GET(req: Request) {
  const dyad = await dyadFromRequest(req);
  if (!dyad) return unauthorized();
  await ensureSchema();

  const rows = await sql`
    SELECT id, word, category, is_preference_pointer, image_data, emoji, source, created_at
    FROM dyad_custom_word WHERE dyad_id = ${dyad.id} ORDER BY created_at DESC
  `;
  return ok(rows);
}

export async function POST(req: Request) {
  const dyad = await dyadFromRequest(req);
  if (!dyad) return unauthorized();
  await ensureSchema();

  const body = await req.json().catch(() => ({}));
  const { word, category, is_preference_pointer, image_data, emoji } = body;

  if (!word || !category) return badRequest('word and category are required');
  if (category !== 'topic' && category !== 'action') return badRequest("category must be 'topic' or 'action'");

  const id = nanoid();
  await sql`
    INSERT INTO dyad_custom_word (id, dyad_id, word, category, is_preference_pointer, image_data, emoji, source)
    VALUES (${id}, ${dyad.id}, ${String(word)}, ${category}, ${!!is_preference_pointer}, ${image_data ?? null}, ${emoji ?? null}, 'parent')
  `;
  return ok({ id, word, category, is_preference_pointer: !!is_preference_pointer, image_data: image_data ?? null, emoji: emoji ?? null, source: 'parent' });
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
