import { sql, ensureSchema } from '@/lib/db';
import { dyadFromRequest } from '@/lib/auth';
import { ok, badRequest, unauthorized } from '@/lib/responses';
import { nanoid } from 'nanoid';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const dyad = await dyadFromRequest(req);
  if (!dyad) return unauthorized();
  await ensureSchema();

  const body = await req.json().catch(() => ({}));
  const { screen, element, event_type, session_id, metadata, ts } = body;

  if (!screen || !element) return badRequest('screen and element are required');

  await sql`
    INSERT INTO user_event (id, dyad_id, session_id, screen, element, event_type, metadata, ts)
    VALUES (
      ${nanoid()},
      ${dyad.id},
      ${session_id ?? null},
      ${String(screen)},
      ${String(element)},
      ${String(event_type ?? 'tap')},
      ${metadata ? JSON.stringify(metadata) : null},
      ${Number(ts ?? Date.now())}
    )
  `;
  return ok({ ok: true });
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
