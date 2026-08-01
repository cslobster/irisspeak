import { sql, ensureSchema } from '@/lib/db';
import { adminFromRequest } from '@/lib/auth';
import { ok, unauthorized } from '@/lib/responses';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Admin visibility into a dyad's Custom Vocabulary Words (see CONTEXT.md) — read-only, so
// staff can see what a parent has added without needing DB access.
export async function GET(req: Request, { params }: { params: { id: string } }) {
  if (!await adminFromRequest(req)) return unauthorized();
  await ensureSchema();

  const { id } = params;
  const rows = await sql`
    SELECT id, word, category, is_preference_pointer, image_data, emoji, source, created_at
    FROM dyad_custom_word WHERE dyad_id = ${id} ORDER BY created_at DESC
  `;
  return ok(rows);
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
