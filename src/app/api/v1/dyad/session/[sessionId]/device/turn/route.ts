import { sql, ensureSchema } from '@/lib/db';
import { dyadFromRequest } from '@/lib/auth';
import { ok, unauthorized, forbidden, badRequest, serverError } from '@/lib/responses';
import { nanoid } from 'nanoid';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Records one turn produced by a client that runs its own card model on the device (irisspeak.org).
 * The server does no recommendation here; it only stores what happened so transcripts, history and the
 * admin site see the same data as the LLM-driven web client.
 *   { role: 'parent', text }                                   the partner's spoken or typed message
 *   { role: 'child', cards: CardInfo[], sentence, shown? }      the confirmed cards, the sentence spoken, the board shown
 * Returns { turn_id }.
 */
export async function POST(req: Request, ctx: { params: { sessionId: string } }) {
  await ensureSchema();
  const dyad = await dyadFromRequest(req);
  if (!dyad) return unauthorized();
  const sessionId = ctx.params.sessionId;
  const own = (await sql`SELECT id, title FROM session WHERE id = ${sessionId} AND dyad_id = ${dyad.id} LIMIT 1`) as any[];
  if (!own[0]) return forbidden();
  const body = await req.json().catch(() => ({}));
  const role = body?.role;
  if (role !== 'parent' && role !== 'child') return badRequest("role must be 'parent' or 'child'");
  const ts = Number(body.timestamp) || Date.now();
  const turnId = nanoid();
  try {
    if (role === 'parent') {
      const text = String(body.text ?? '').trim();
      if (!text) return badRequest('text required');
      await sql`INSERT INTO dialogue_turn (id, session_id, role, started_timestamp, ended_timestamp) VALUES (${turnId}, ${sessionId}, 'parent', ${ts}, ${ts})`;
      await sql`INSERT INTO dialogue_message (id, session_id, turn_id, role, content_type, content, timestamp)
                VALUES (${nanoid()}, ${sessionId}, ${turnId}, 'parent', 'text', ${JSON.stringify(text)}::jsonb, ${ts})`;
      await sql`UPDATE session SET num_turns = num_turns + 1, status = 'conversation',
                started_timestamp = COALESCE(started_timestamp, ${ts}), title = COALESCE(title, ${text.slice(0, 60)})
                WHERE id = ${sessionId}`;
    } else {
      const cards = Array.isArray(body.cards) ? body.cards : [];
      if (cards.length === 0) return badRequest('cards required');
      const sentence = body.sentence ? String(body.sentence) : null;
      await sql`INSERT INTO dialogue_turn (id, session_id, role, started_timestamp, ended_timestamp, inferred_sentence)
                VALUES (${turnId}, ${sessionId}, 'child', ${ts}, ${ts}, ${sentence})`;
      if (Array.isArray(body.shown) && body.shown.length) {
        await sql`INSERT INTO child_card_recommendation (id, session_id, turn_id, cards, timestamp)
                  VALUES (${nanoid()}, ${sessionId}, ${turnId}, ${JSON.stringify(body.shown)}::jsonb, ${ts})`;
      }
      await sql`INSERT INTO dialogue_message (id, session_id, turn_id, role, content_type, content, timestamp)
                VALUES (${nanoid()}, ${sessionId}, ${turnId}, 'child', 'cards', ${JSON.stringify(cards)}::jsonb, ${ts})`;
      await sql`UPDATE session SET num_turns = num_turns + 1, status = 'conversation', started_timestamp = COALESCE(started_timestamp, ${ts}) WHERE id = ${sessionId}`;
    }
    return ok({ turn_id: turnId });
  } catch (e: any) {
    return serverError(e?.message || 'turn failed');
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
