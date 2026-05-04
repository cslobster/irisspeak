import { dyadFromRequest } from '@/lib/auth';
import { abortSession } from '@/lib/moderator';
import { noContent, unauthorized, serverError } from '@/lib/responses';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function DELETE(req: Request, ctx: { params: { sessionId: string } }) {
  const dyad = await dyadFromRequest(req);
  if (!dyad) return unauthorized();
  try { await abortSession(ctx.params.sessionId, dyad); return noContent(); }
  catch (e: any) { return serverError(e?.message || 'abort failed'); }
}
