import { sql, ensureSchema } from '@/lib/db';
import { dyadFromRequest } from '@/lib/auth';
import { ok, badRequest, unauthorized } from '@/lib/responses';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Lets a signed-in dyad (however they signed in — including Google, which otherwise leaves the
// account with no password at all) set or change the login code used by POST /account/login. Google
// accounts get a random unmemorable alias (see google/callback), so that route also accepts the
// parent email as the username — this is what makes "sign in without Google" work end to end.
export async function POST(req: Request) {
  const dyad = await dyadFromRequest(req);
  if (!dyad) return unauthorized();
  await ensureSchema();

  const { login_code } = await req.json().catch(() => ({}));
  const code = String(login_code || '').trim();
  if (code.length < 4) return badRequest('login_code must be at least 4 characters');

  await sql`UPDATE dyad_login_code SET active = FALSE WHERE dyad_id = ${dyad.id}`;
  await sql`INSERT INTO dyad_login_code (code, dyad_id, active) VALUES (${code}, ${dyad.id}, TRUE)`;

  return ok({ alias: dyad.alias, parent_email: dyad.parent_email || null });
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
