import { sql, ensureSchema } from '@/lib/db';
import { adminFromRequest } from '@/lib/auth';
import { ok, unauthorized, notFound, badRequest } from '@/lib/responses';
import { nanoid } from 'nanoid';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Approves a wizard signup: flips status to 'active' and activates the login code the parent
// already chose during signup (stored inactive until now — see account/signup/route.ts). This
// is the only way the parent finds out their code: they picked it themselves, so there's
// nothing to communicate back to them. Admin can still override with an explicit login_code in
// the request body if needed (e.g. the parent forgot what they typed), matching how
// admin-created accounts already let staff set a code directly.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!await adminFromRequest(req)) return unauthorized();
  await ensureSchema();

  const { id } = params;
  const existing = await sql`SELECT id, status FROM dyad WHERE id = ${id} LIMIT 1`;
  if (!existing.length) return notFound('Dyad not found');
  if (existing[0].status === 'active') return badRequest('Already active');

  const body = await req.json().catch(() => ({}));
  await sql`UPDATE dyad SET status = 'active' WHERE id = ${id}`;

  let loginCode: string;
  if (body.login_code) {
    // Explicit admin override — deactivate whatever the parent chose, issue this instead.
    await sql`UPDATE dyad_login_code SET active = FALSE WHERE dyad_id = ${id}`;
    loginCode = String(body.login_code);
    await sql`
      INSERT INTO dyad_login_code (code, dyad_id, active) VALUES (${loginCode}, ${id}, TRUE)
      ON CONFLICT (code, dyad_id) DO UPDATE SET active = TRUE
    `;
  } else {
    // Normal path: activate the code the parent already chose at signup.
    const rows = await sql`
      UPDATE dyad_login_code SET active = TRUE WHERE dyad_id = ${id} AND active = FALSE
      RETURNING code
    `;
    if (rows[0]) {
      loginCode = rows[0].code;
    } else {
      // Defensive fallback — shouldn't happen since the wizard requires a login_code, but
      // covers any dyad that somehow reached 'pending' without one.
      loginCode = String(Math.floor(10000 + Math.random() * 90000));
      await sql`INSERT INTO dyad_login_code (code, dyad_id) VALUES (${loginCode}, ${id})`;
    }
  }

  return ok({ id, status: 'active', login_code: loginCode });
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
