import { dyadFromRequest } from '@/lib/auth';
import { addChildCard } from '@/lib/moderator';
import { ok, unauthorized, badRequest, serverError } from '@/lib/responses';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: { sessionId: string } }) {
  const dyad = await dyadFromRequest(req);
  if (!dyad) return unauthorized();
  const body = await req.json().catch(() => ({}));
  if (!body?.id || !body?.recommendation_id) return badRequest('id + recommendation_id required');
  try {
    const r = await addChildCard(ctx.params.sessionId, dyad, { id: body.id, recommendation_id: body.recommendation_id });
    return ok(r);
  } catch (e: any) { return serverError(e?.message || 'add_card failed'); }
}
