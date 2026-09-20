import { sql, ensureSchema } from '@/lib/db';
import { adminFromRequest } from '@/lib/auth';
import { ok, unauthorized } from '@/lib/responses';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** All problem reports across every account, newest first, for the admin "Reports" page.
 *  ?status=open|resolved filters. screenshot_data is left out of the list — thousands of base64
 *  images in one response doesn't scale — fetch GET /admin/reports/[id] for one report's full detail. */
export async function GET(req: Request) {
  if (!await adminFromRequest(req)) return unauthorized();
  await ensureSchema();
  const url = new URL(req.url);
  const status = url.searchParams.get('status');

  const rows = status
    ? await sql`
        SELECT r.id, r.dyad_id, r.session_id, r.description, r.status, r.created_at,
               (r.screenshot_data IS NOT NULL) AS has_screenshot, d.alias, d.child_name, d.parent_email
        FROM problem_report r LEFT JOIN dyad d ON d.id = r.dyad_id
        WHERE r.status = ${status}
        ORDER BY r.created_at DESC LIMIT 2000`
    : await sql`
        SELECT r.id, r.dyad_id, r.session_id, r.description, r.status, r.created_at,
               (r.screenshot_data IS NOT NULL) AS has_screenshot, d.alias, d.child_name, d.parent_email
        FROM problem_report r LEFT JOIN dyad d ON d.id = r.dyad_id
        ORDER BY r.created_at DESC LIMIT 2000`;
  return ok(rows);
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
