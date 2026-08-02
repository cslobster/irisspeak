import { sql, ensureSchema } from '@/lib/db';
import { adminFromRequest } from '@/lib/auth';
import { ok, unauthorized } from '@/lib/responses';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  if (!await adminFromRequest(req)) return unauthorized();
  await ensureSchema();

  const rows = await sql`
    SELECT
      d.id,
      d.alias,
      d.child_name,
      d.child_gender,
      d.locale,
      d.created_at,
      COUNT(DISTINCT s.id)::int          AS session_count,
      COALESCE(SUM(s.num_turns), 0)::int AS total_turns,
      COUNT(dm.id)::int                  AS total_messages,
      MAX(s.created_at)                  AS last_active
    FROM dyad d
    LEFT JOIN session s ON s.dyad_id = d.id
    LEFT JOIN dialogue_message dm ON dm.session_id = s.id
    GROUP BY d.id, d.alias, d.child_name, d.child_gender, d.locale, d.created_at
    ORDER BY last_active DESC NULLS LAST
  `;
  return ok(rows);
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
