import { sql, ensureSchema } from '@/lib/db';
import { adminFromRequest } from '@/lib/auth';
import { ok, unauthorized } from '@/lib/responses';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request, { params }: { params: { id: string } }) {
  if (!await adminFromRequest(req)) return unauthorized();
  await ensureSchema();

  const { id } = params;

  const sessions = await sql`
    SELECT id, topic_category, subtopic, status, num_turns, started_timestamp, ended_timestamp, created_at
    FROM session
    WHERE dyad_id = ${id}
    ORDER BY created_at DESC
  `;

  const messages = sessions.length > 0
    ? await sql`
        SELECT m.id, m.session_id, m.role, m.content_type, m.content, m.timestamp,
               t.inferred_sentence
        FROM dialogue_message m
        LEFT JOIN dialogue_turn t ON t.id = m.turn_id
        WHERE m.session_id = ANY(${sessions.map((s: any) => s.id)})
        ORDER BY m.session_id, m.timestamp
      `
    : [];

  return ok({ sessions, messages });
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
