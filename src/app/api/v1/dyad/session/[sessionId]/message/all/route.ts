import { sql, ensureSchema } from '@/lib/db';
import { dyadFromRequest } from '@/lib/auth';
import { ok, unauthorized, forbidden } from '@/lib/responses';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request, ctx: { params: { sessionId: string } }) {
  await ensureSchema();
  const dyad = await dyadFromRequest(req);
  if (!dyad) return unauthorized();
  const own = (await sql`SELECT 1 FROM session WHERE id = ${ctx.params.sessionId} AND dyad_id = ${dyad.id} LIMIT 1`) as any[];
  if (!own[0]) return forbidden();
  const rows = (await sql`
    SELECT m.role, m.content_type, m.content, m.turn_id, m.timestamp, t.inferred_sentence
    FROM dialogue_message m
    LEFT JOIN dialogue_turn t ON t.id = m.turn_id
    WHERE m.session_id = ${ctx.params.sessionId}
    ORDER BY m.timestamp ASC
  `) as any[];
  const dialogue = rows.map((r) => ({
    role: r.role,
    content: r.content_type === 'text' ? String(r.content) : r.content,
    content_localized: r.content_type === 'cards' && r.inferred_sentence ? r.inferred_sentence : undefined,
    turn_id: r.turn_id,
    timestamp: Number(r.timestamp),
  }));
  return ok({ dyad_id: dyad.id, dialogue });
}
