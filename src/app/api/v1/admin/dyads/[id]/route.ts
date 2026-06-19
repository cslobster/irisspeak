import { sql, ensureSchema } from '@/lib/db';
import { adminFromRequest } from '@/lib/auth';
import { ok, badRequest, unauthorized, notFound } from '@/lib/responses';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!await adminFromRequest(req)) return unauthorized();
  await ensureSchema();

  const { id } = params;
  const body = await req.json().catch(() => ({}));
  const { alias, child_name, child_gender, parent_type, locale, login_code } = body;

  const existing = await sql`SELECT id FROM dyad WHERE id = ${id} LIMIT 1`;
  if (!existing.length) return notFound('Dyad not found');

  if (alias || child_name || child_gender || parent_type || locale) {
    await sql`
      UPDATE dyad SET
        alias        = COALESCE(${alias ?? null}, alias),
        child_name   = COALESCE(${child_name ?? null}, child_name),
        child_gender = COALESCE(${child_gender ?? null}, child_gender),
        parent_type  = COALESCE(${parent_type ?? null}, parent_type),
        locale       = COALESCE(${locale ?? null}, locale)
      WHERE id = ${id}
    `;
  }

  if (login_code) {
    await sql`UPDATE dyad_login_code SET active = FALSE WHERE dyad_id = ${id}`;
    await sql`
      INSERT INTO dyad_login_code (code, dyad_id, active) VALUES (${login_code}, ${id}, TRUE)
      ON CONFLICT (code, dyad_id) DO UPDATE SET active = TRUE
    `;
  }

  const [updated] = await sql`
    SELECT d.*, lc.code AS login_code
    FROM dyad d
    LEFT JOIN dyad_login_code lc ON lc.dyad_id = d.id AND lc.active = TRUE
    WHERE d.id = ${id}
    LIMIT 1
  `;
  return ok(updated);
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  if (!await adminFromRequest(req)) return unauthorized();
  await ensureSchema();

  const { id } = params;
  const existing = await sql`SELECT id FROM dyad WHERE id = ${id} LIMIT 1`;
  if (!existing.length) return notFound('Dyad not found');

  await sql`DELETE FROM dyad WHERE id = ${id}`;
  return ok({ deleted: id });
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
