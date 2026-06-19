import { dyadFromRequest } from '@/lib/auth';
import { ensureSchema, sql } from '@/lib/db';
import { noContent, unauthorized, badRequest, serverError } from '@/lib/responses';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function PUT(req: Request, ctx: { params: { sessionId: string } }) {
  const dyad = await dyadFromRequest(req);
  if (!dyad) return unauthorized();
  try {
    await ensureSchema();
    const { rating } = await req.json();
    if (typeof rating !== 'number' || rating < 1 || rating > 5) return badRequest('rating must be 1–5');
    const rows = await sql`
      UPDATE session SET rating = ${rating}
      WHERE id = ${ctx.params.sessionId} AND dyad_id = ${dyad.id}
      RETURNING id
    `;
    if (rows.length === 0) return badRequest('session not found');
    return noContent();
  } catch (e: any) { return serverError(e?.message || 'rating failed'); }
}
