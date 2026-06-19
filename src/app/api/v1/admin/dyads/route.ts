import { sql, ensureSchema } from '@/lib/db';
import { adminFromRequest } from '@/lib/auth';
import { ok, badRequest, unauthorized } from '@/lib/responses';
import { nanoid } from 'nanoid';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  if (!await adminFromRequest(req)) return unauthorized();
  await ensureSchema();
  const rows = await sql`
    SELECT d.*, lc.code AS login_code
    FROM dyad d
    LEFT JOIN dyad_login_code lc ON lc.dyad_id = d.id AND lc.active = TRUE
    ORDER BY d.created_at DESC
  `;
  return ok(rows);
}

export async function POST(req: Request) {
  if (!await adminFromRequest(req)) return unauthorized();
  await ensureSchema();

  const body = await req.json().catch(() => ({}));
  const { alias, child_name, child_gender, parent_type, locale, login_code } = body;

  if (!alias || !child_name || !child_gender || !parent_type || !login_code) {
    return badRequest('alias, child_name, child_gender, parent_type, and login_code are required');
  }

  const id = nanoid();
  const localeVal = locale || 'en';

  await sql`
    INSERT INTO dyad (id, alias, child_name, child_gender, parent_type, locale)
    VALUES (${id}, ${alias}, ${child_name}, ${child_gender}, ${parent_type}, ${localeVal})
  `;
  await sql`
    INSERT INTO dyad_login_code (code, dyad_id)
    VALUES (${login_code}, ${id})
  `;

  return ok({ id, alias, child_name, child_gender, parent_type, locale: localeVal, login_code });
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
