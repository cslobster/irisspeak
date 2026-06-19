import { dyadFromRequest } from '@/lib/auth';
import { inferSentenceFromCards } from '@/lib/moderator';
import { ok, unauthorized, serverError } from '@/lib/responses';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: { sessionId: string } }) {
  const dyad = await dyadFromRequest(req);
  if (!dyad) return unauthorized();
  try {
    const sentence = await inferSentenceFromCards(ctx.params.sessionId, dyad);
    return ok({ sentence });
  } catch (e: any) { return serverError(e?.message || 'infer failed'); }
}
