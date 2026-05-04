import { sql, ensureSchema } from '@/lib/db';
import { dyadFromRequest } from '@/lib/auth';
import { ok, unauthorized } from '@/lib/responses';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request, ctx: { params: { sessionId: string } }) {
  await ensureSchema();
  const dyad = await dyadFromRequest(req);
  if (!dyad) return unauthorized();
  const rows = (await sql`
    SELECT role, content_type, content, turn_id, timestamp
    FROM dialogue_message
    WHERE session_id = ${ctx.params.sessionId}
    ORDER BY timestamp ASC
  `) as any[];
  const dialogue = rows.map((r) => ({
    role: r.role,
    content: r.content_type === 'text' ? String(r.content) : r.content,
    turn_id: r.turn_id,
    timestamp: Number(r.timestamp),
  }));
  return ok({ dyad_id: dyad.id, dialogue });
}
