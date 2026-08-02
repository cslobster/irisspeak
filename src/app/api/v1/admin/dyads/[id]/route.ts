import { sql, ensureSchema } from '@/lib/db';
import { adminFromRequest } from '@/lib/auth';
import { ok, badRequest, unauthorized, notFound } from '@/lib/responses';
import { capitalizeName } from '@/lib/text';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!await adminFromRequest(req)) return unauthorized();
  await ensureSchema();

  const { id } = params;
  const body = await req.json().catch(() => ({}));
  const {
    alias, child_name, child_gender, locale, login_code,
    age, communication_style, notes, parent_email,
  } = body;

  const existing = await sql`SELECT id FROM dyad WHERE id = ${id} LIMIT 1`;
  if (!existing.length) return notFound('Dyad not found');

  const childNameVal = child_name ? capitalizeName(child_name) : null;

  if (alias || child_name || child_gender || locale
      || age !== undefined || communication_style || notes || parent_email) {
    await sql`
      UPDATE dyad SET
        alias                = COALESCE(${alias ?? null}, alias),
        child_name           = COALESCE(${childNameVal}, child_name),
        child_gender         = COALESCE(${child_gender ?? null}, child_gender),
        locale               = COALESCE(${locale ?? null}, locale),
        age                  = COALESCE(${age ?? null}, age),
        communication_style  = COALESCE(${communication_style ?? null}, communication_style),
        notes                = COALESCE(${notes ?? null}, notes),
        parent_email         = COALESCE(${parent_email ?? null}, parent_email)
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
