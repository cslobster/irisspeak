import { sql, ensureSchema } from '@/lib/db';
import { dyadFromRequest } from '@/lib/auth';
import { ok, unauthorized, notFound } from '@/lib/responses';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const dyad = await dyadFromRequest(req);
  if (!dyad) return unauthorized();
  await ensureSchema();

  const { id } = params;
  // Scoped to this dyad's own id, not just the word's id — a parent can only delete their own
  // child's custom words, never another dyad's (see CONTEXT.md's isolation reasoning: scoping
  // by dyad_id, not physical duplication, is what keeps one child's words out of another's).
  const existing = await sql`SELECT id FROM dyad_custom_word WHERE id = ${id} AND dyad_id = ${dyad.id} LIMIT 1`;
  if (!existing.length) return notFound('Word not found');

  await sql`DELETE FROM dyad_custom_word WHERE id = ${id}`;
  return ok({ deleted: id });
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
