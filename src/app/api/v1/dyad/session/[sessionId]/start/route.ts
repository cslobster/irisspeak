import { dyadFromRequest } from '@/lib/auth';
import { startSession } from '@/lib/moderator';
import { ok, unauthorized, serverError } from '@/lib/responses';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request, ctx: { params: { sessionId: string } }) {
  const dyad = await dyadFromRequest(req);
  if (!dyad) return unauthorized();
  try {
    const { turn_id, recommendation } = await startSession(ctx.params.sessionId, dyad);
    return ok({ parent_guides: recommendation, turn_id });
  } catch (e: any) {
    return serverError(e?.message || 'start failed');
  }
}
