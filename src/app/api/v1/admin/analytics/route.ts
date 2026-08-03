import { sql, ensureSchema } from '@/lib/db';
import { adminFromRequest } from '@/lib/auth';
import { ok, unauthorized } from '@/lib/responses';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  if (!await adminFromRequest(req)) return unauthorized();
  await ensureSchema();

  const url = new URL(req.url);
  const view = url.searchParams.get('view') || 'summary';

  if (view === 'dau') {
    // Clamped so a bad/huge query param can't force an expensive generate_series scan.
    const days = Math.min(Math.max(parseInt(url.searchParams.get('days') || '30', 10) || 30, 1), 90);
    // generate_series + LEFT JOIN so a day with zero activity still shows up as 0 rather than
    // being silently skipped — a gap in the line would otherwise look like missing data.
    const rows = await sql`
      SELECT
        gs.day::date                      AS date,
        COUNT(DISTINCT e.dyad_id)::int    AS active_users
      FROM generate_series(
        CURRENT_DATE - (${days} - 1) * INTERVAL '1 day',
        CURRENT_DATE,
        INTERVAL '1 day'
      ) AS gs(day)
      LEFT JOIN user_event e ON date_trunc('day', e.created_at) = gs.day
      GROUP BY gs.day
      ORDER BY gs.day
    `;
    return ok(rows);
  }

  if (view === 'by_user') {
    // Per-user breakdown: dyad × screen × element
    const rows = await sql`
      SELECT
        e.dyad_id,
        d.alias,
        d.child_name,
        e.screen,
        e.element,
        e.event_type,
        COUNT(*)::int   AS event_count,
        MAX(e.created_at) AS last_seen
      FROM user_event e
      JOIN dyad d ON d.id = e.dyad_id
      GROUP BY e.dyad_id, d.alias, d.child_name, e.screen, e.element, e.event_type
      ORDER BY d.alias, e.screen, e.element
    `;
    return ok(rows);
  }

  // Default: global summary — screen × element totals
  const rows = await sql`
    SELECT
      e.screen,
      e.element,
      e.event_type,
      COUNT(*)::int                     AS event_count,
      COUNT(DISTINCT e.dyad_id)::int    AS unique_users,
      MAX(e.created_at)                 AS last_seen
    FROM user_event e
    GROUP BY e.screen, e.element, e.event_type
    ORDER BY event_count DESC
  `;
  return ok(rows);
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
