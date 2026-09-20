import { sql, ensureSchema } from '@/lib/db';
import { adminFromRequest } from '@/lib/auth';
import { ok, unauthorized, notFound, badRequest } from '@/lib/responses';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** One report's full detail, screenshot included — the list route (GET /admin/reports) omits it. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  if (!await adminFromRequest(req)) return unauthorized();
  await ensureSchema();
  const rows = await sql`
    SELECT r.*, d.alias, d.child_name, d.parent_email
    FROM problem_report r LEFT JOIN dyad d ON d.id = r.dyad_id
    WHERE r.id = ${params.id} LIMIT 1
  `;
  if (!rows[0]) return notFound();
  return ok(rows[0]);
}

/** Mark a report open/resolved once someone's looked at it. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!await adminFromRequest(req)) return unauthorized();
  await ensureSchema();
  const { status } = await req.json().catch(() => ({}));
  if (status !== 'open' && status !== 'resolved') return badRequest("status must be 'open' or 'resolved'");
  await sql`UPDATE problem_report SET status = ${status} WHERE id = ${params.id}`;
  return ok({ id: params.id, status });
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
