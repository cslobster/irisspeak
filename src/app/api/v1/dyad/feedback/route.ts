import { sql, ensureSchema } from '@/lib/db';
import { dyadFromRequest } from '@/lib/auth';
import { ok, unauthorized, badRequest, serverError } from '@/lib/responses';
import { nanoid } from 'nanoid';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * A partner's feedback on one board (the Feedback button under the child's board).
 *   POST { session_id?, setting, question, candidates: [{id,label,category,personal?}], prefix: string[],
 *          choice: 'no_cards' | 'own_answer', answer?, model_version?, client?, timestamp? }
 *   GET  the family's own feedback, newest first
 * Stored in board_feedback as training material: the setting, the question, the board that was shown, and
 * what the partner says the child wanted to say instead.
 */
export async function POST(req: Request) {
  await ensureSchema();
  const dyad = await dyadFromRequest(req);
  if (!dyad) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const choice = body?.choice;
  if (choice !== 'no_cards' && choice !== 'own_answer') return badRequest("choice must be 'no_cards' or 'own_answer'");
  const setting = String(body.setting ?? '').trim().slice(0, 40);
  const question = String(body.question ?? '').trim().slice(0, 400);
  if (!setting || !question) return badRequest('setting and question required');
  const answer = choice === 'own_answer' ? String(body.answer ?? '').trim().slice(0, 400) : null;
  if (choice === 'own_answer' && !answer) return badRequest('answer required');
  const candidates = Array.isArray(body.candidates) ? body.candidates.slice(0, 60) : [];
  const prefix = Array.isArray(body.prefix) ? body.prefix.slice(0, 12) : [];
  const id = nanoid();
  try {
    await sql`INSERT INTO board_feedback (id, dyad_id, session_id, setting, question, candidates, prefix, choice, answer, model_version, client, timestamp)
              VALUES (${id}, ${dyad.id}, ${body.session_id ? String(body.session_id) : null}, ${setting}, ${question},
                      ${JSON.stringify(candidates)}::jsonb, ${JSON.stringify(prefix)}::jsonb, ${choice}, ${answer},
                      ${body.model_version ? String(body.model_version).slice(0, 40) : null}, ${body.client ? String(body.client).slice(0, 40) : null},
                      ${Number(body.timestamp) || Date.now()})`;
    return ok({ id });
  } catch (e) { return serverError(e); }
}

export async function GET(req: Request) {
  await ensureSchema();
  const dyad = await dyadFromRequest(req);
  if (!dyad) return unauthorized();
  const rows = await sql`SELECT id, session_id, setting, question, candidates, prefix, choice, answer, model_version, timestamp
                         FROM board_feedback WHERE dyad_id = ${dyad.id} ORDER BY timestamp DESC LIMIT 200`;
  return ok({ feedback: rows });
}
