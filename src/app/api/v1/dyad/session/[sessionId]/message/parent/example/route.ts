import { dyadFromRequest } from '@/lib/auth';
import { requestParentExample } from '@/lib/moderator';
import { ok, unauthorized, badRequest, serverError } from '@/lib/responses';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: { sessionId: string } }) {
  const dyad = await dyadFromRequest(req);
  if (!dyad) return unauthorized();
  const body = await req.json().catch(() => ({}));
  if (!body?.recommendation_id || !body?.guide_id) {
    return badRequest('recommendation_id + guide_id required');
  }
  try {
    const out = await requestParentExample(ctx.params.sessionId, dyad, String(body.recommendation_id), String(body.guide_id));
    return ok(out);
  } catch (e: any) {
    return serverError(e?.message || 'example failed');
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
