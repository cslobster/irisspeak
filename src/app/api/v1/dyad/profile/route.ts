import { sql, ensureSchema } from '@/lib/db';
import { dyadFromRequest } from '@/lib/auth';
import { ok, unauthorized } from '@/lib/responses';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const dyad = await dyadFromRequest(req);
  if (!dyad) return unauthorized();
  await ensureSchema();

  const [row] = await sql`
    SELECT d.age, d.notes, d.communication_style, d.setting, d.child_name, d.child_gender, d.alias,
           d.parent_email, EXISTS(SELECT 1 FROM dyad_login_code lc WHERE lc.dyad_id = d.id AND lc.active = TRUE) AS has_password
    FROM dyad d WHERE d.id = ${dyad.id} LIMIT 1
  `;
  return ok(row);
}

export async function PATCH(req: Request) {
  const dyad = await dyadFromRequest(req);
  if (!dyad) return unauthorized();
  await ensureSchema();

  const body = await req.json().catch(() => ({}));
  const { age, notes, communication_style, setting, child_name, child_gender } = body;
  const gender = child_gender === 'boy' || child_gender === 'girl' ? child_gender : null;   // first-run setup on the apps

  await sql`
    UPDATE dyad SET
      age                  = COALESCE(${age ?? null}, age),
      notes                = COALESCE(${notes ?? null}, notes),
      communication_style  = COALESCE(${communication_style ?? null}, communication_style),
      setting              = COALESCE(${setting ?? null}, setting),
      child_name           = COALESCE(${child_name ? String(child_name).trim() || null : null}, child_name),
      child_gender         = COALESCE(${gender}, child_gender)
    WHERE id = ${dyad.id}
  `;

  const [row] = await sql`
    SELECT age, notes, communication_style, setting, child_name, child_gender, alias FROM dyad WHERE id = ${dyad.id} LIMIT 1
  `;
  return ok(row);
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
