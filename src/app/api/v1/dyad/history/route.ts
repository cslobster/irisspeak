import { sql, ensureSchema } from '@/lib/db';
import { dyadFromRequest } from '@/lib/auth';
import { ok, unauthorized } from '@/lib/responses';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The child's recent confirmed turns across every session, newest first, for a client that keeps a
 * personal history on the device (irisspeak.org feeds it to its reranker and prompt).
 *   GET /api/v1/dyad/history?limit=50 -> { turns: [{ partner, answer, cards: [card ids], t, session_id }] }
 */
export async function GET(req: Request) {
  await ensureSchema();
  const dyad = await dyadFromRequest(req);
  if (!dyad) return unauthorized();
  const limit = Math.max(1, Math.min(200, Number(new URL(req.url).searchParams.get('limit')) || 50));
  const rows = (await sql`
    SELECT m.session_id, m.content AS cards, m.timestamp, t.inferred_sentence,
           (SELECT pm.content FROM dialogue_message pm
             WHERE pm.session_id = m.session_id AND pm.role = 'parent' AND pm.content_type = 'text' AND pm.timestamp < m.timestamp
             ORDER BY pm.timestamp DESC LIMIT 1) AS partner
    FROM dialogue_message m
    JOIN dialogue_turn t ON t.id = m.turn_id
    JOIN session s ON s.id = m.session_id
    WHERE s.dyad_id = ${dyad.id} AND m.role = 'child' AND m.content_type = 'cards'
    ORDER BY m.timestamp DESC
    LIMIT ${limit}
  `) as any[];
  const turns = rows.map((r) => {
    const cards = Array.isArray(r.cards) ? r.cards : [];
    return {
      partner: r.partner ? String(r.partner) : '',
      answer: r.inferred_sentence || cards.map((c: any) => c.corpus_name || c.label).join(' '),
      cards: cards.map((c: any) => c.id).filter((x: any) => typeof x === 'string'),
      t: Number(r.timestamp), session_id: r.session_id,
    };
  });
  return ok({ dyad_id: dyad.id, turns });
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
