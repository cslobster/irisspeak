import { dyadFromRequest } from '@/lib/auth';
import { confirmChildCardSelection } from '@/lib/moderator';
import { ok, unauthorized, serverError } from '@/lib/responses';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: { sessionId: string } }) {
  const dyad = await dyadFromRequest(req);
  if (!dyad) return unauthorized();
  try {
    const { turn_id, recommendation } = await confirmChildCardSelection(ctx.params.sessionId, dyad);
    return ok({ payload: recommendation, next_turn_id: turn_id });
  } catch (e: any) { return serverError(e?.message || 'confirm failed'); }
}
