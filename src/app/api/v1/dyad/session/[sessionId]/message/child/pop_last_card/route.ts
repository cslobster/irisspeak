import { dyadFromRequest } from '@/lib/auth';
import { removeChildCardAtIndex } from '@/lib/moderator';
import { ok, unauthorized, serverError } from '@/lib/responses';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function PUT(req: Request, ctx: { params: { sessionId: string } }) {
  const dyad = await dyadFromRequest(req);
  if (!dyad) return unauthorized();
  try {
    const body = await req.json().catch(() => ({}));
    const index = typeof body.index === 'number' ? body.index : -1;
    return ok(await removeChildCardAtIndex(ctx.params.sessionId, dyad, index));
  } catch (e: any) { return serverError(e?.message || 'remove failed'); }
}
