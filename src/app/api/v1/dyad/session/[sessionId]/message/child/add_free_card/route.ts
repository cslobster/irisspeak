import { dyadFromRequest } from '@/lib/auth';
import { addFreeCard } from '@/lib/moderator';
import { ok, unauthorized, badRequest, serverError } from '@/lib/responses';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: { sessionId: string } }) {
  const dyad = await dyadFromRequest(req);
  if (!dyad) return unauthorized();
  const body = await req.json().catch(() => ({}));
  if (!body?.label || !body?.category) return badRequest('label + category required');
  try {
    const r = await addFreeCard(ctx.params.sessionId, dyad, {
      label: body.label,
      category: body.category,
      image_url: body.image_url ?? null,
    });
    return ok(r);
  } catch (e: any) { return serverError(e?.message || 'add_free_card failed'); }
}
