import { sql, ensureSchema } from '@/lib/db';
import { adminFromRequest } from '@/lib/auth';
import { ok, unauthorized } from '@/lib/responses';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** One account's problem reports, newest first, for the "Reports" sub-tab in its detail view. Includes
 *  the screenshot — one account's worth is small enough, unlike the global list. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  if (!await adminFromRequest(req)) return unauthorized();
  await ensureSchema();
  const { id } = params;
  const reports = await sql`
    SELECT id, session_id, description, screenshot_data, context, status, created_at
    FROM problem_report WHERE dyad_id = ${id} ORDER BY created_at DESC
  `;
  return ok({ reports });
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
