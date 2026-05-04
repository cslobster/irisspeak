import { dyadFromRequest } from '@/lib/auth';
import { submitParentMessage } from '@/lib/moderator';
import { ok, unauthorized, badRequest, serverError } from '@/lib/responses';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: { sessionId: string } }) {
  const dyad = await dyadFromRequest(req);
  if (!dyad) return unauthorized();
  const body = await req.json().catch(() => ({}));
  if (!body?.message) return badRequest('message required');
  try {
    const { turn_id, recommendation } = await submitParentMessage(ctx.params.sessionId, dyad, String(body.message));
    return ok({ payload: recommendation, next_turn_id: turn_id });
  } catch (e: any) {
    console.error('[parent-text] failed:', e);
    return serverError(e?.message || 'submit failed');
  }
}
