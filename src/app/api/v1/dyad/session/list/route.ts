import { sql, ensureSchema } from '@/lib/db';
import { dyadFromRequest } from '@/lib/auth';
import { ok, unauthorized } from '@/lib/responses';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  await ensureSchema();
  const dyad = await dyadFromRequest(req);
  if (!dyad) return unauthorized();
  const rows = (await sql`
    SELECT id, dyad_id, topic_category, subtopic, subtopic_description, local_timezone,
           status, started_timestamp, ended_timestamp, num_turns, rating, title
    FROM session
    WHERE dyad_id = ${dyad.id}
    ORDER BY created_at DESC
  `) as any[];
  const sessions = rows.map((r) => ({
    id: r.id,
    dyad_id: r.dyad_id,
    topic: { category: r.topic_category, subtopic: r.subtopic, subtopic_description: r.subtopic_description },
    status: r.status,
    local_timezone: r.local_timezone,
    started_timestamp: Number(r.started_timestamp || 0),
    ended_timestamp: r.ended_timestamp ? Number(r.ended_timestamp) : null,
    num_turns: r.num_turns,
    rating: r.rating ?? null,
    title: r.title ?? null,
  }));
  return ok({ dyad_id: dyad.id, sessions });
}
