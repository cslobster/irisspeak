import { sql, ensureSchema } from '@/lib/db';
import { adminFromRequest } from '@/lib/auth';
import { ok, unauthorized } from '@/lib/responses';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * All board feedback, newest first, for the admin site -- and, with ?format=jsonl, as one training row per line
 * ({setting, question, candidates, prefix, choice, answer, model_version}) ready for model/data/build_states.py.
 */
export async function GET(req: Request) {
  if (!await adminFromRequest(req)) return unauthorized();
  await ensureSchema();
  const url = new URL(req.url);
  const rows = (await sql`
    SELECT f.*, d.child_name
    FROM board_feedback f LEFT JOIN dyad d ON d.id = f.dyad_id
    ORDER BY f.timestamp DESC LIMIT 5000`) as any[];
  if (url.searchParams.get('format') === 'jsonl') {
    const lines = rows.map(r => JSON.stringify({ setting: r.setting, question: r.question, candidates: r.candidates, prefix: r.prefix, disliked: r.disliked,
                                                 choice: r.choice, answer: r.answer, model_version: r.model_version, timestamp: Number(r.timestamp) }));
    return new Response(lines.join('\n') + '\n', { headers: { 'content-type': 'application/x-ndjson; charset=utf-8' } });
  }
  return ok(rows);
}
