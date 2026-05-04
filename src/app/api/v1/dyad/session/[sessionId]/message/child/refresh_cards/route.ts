import { dyadFromRequest } from '@/lib/auth';
import { refreshChildCards } from '@/lib/moderator';
import { ok, unauthorized, serverError } from '@/lib/responses';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function PUT(req: Request, ctx: { params: { sessionId: string } }) {
  const dyad = await dyadFromRequest(req);
  if (!dyad) return unauthorized();
  try { return ok(await refreshChildCards(ctx.params.sessionId, dyad)); }
  catch (e: any) { return serverError(e?.message || 'refresh failed'); }
}
