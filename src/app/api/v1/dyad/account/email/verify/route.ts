import { sql, ensureSchema } from '@/lib/db';
import { issueDyadJwt } from '@/lib/auth';
import { ok, badRequest } from '@/lib/responses';
import type { Dyad } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST /api/v1/dyad/account/email/verify  { email, code }  -> { jwt, alias, child_name }
// The code is single use, expires after 10 minutes, and allows five wrong guesses before it is burned.
export async function POST(req: Request) {
  await ensureSchema();
  const body = await req.json().catch(() => ({}));
  const addr = String(body.email || '').trim().toLowerCase();
  const code = String(body.code || '').trim();
  if (!addr || !code) return badRequest('email and code are required');

  const rows = (await sql`
    SELECT id, dyad_id, code, attempts FROM email_login_code
    WHERE email = ${addr} AND used = FALSE AND expires_at > NOW()
    ORDER BY created_at DESC LIMIT 1
  `) as { id: string; dyad_id: string; code: string; attempts: number }[];
  const row = rows[0];
  if (!row) return badRequest('BadCode');

  if (row.code !== code) {
    await sql`UPDATE email_login_code SET attempts = attempts + 1, used = (attempts + 1 >= 5) WHERE id = ${row.id}`;
    return badRequest('BadCode');
  }
  await sql`UPDATE email_login_code SET used = TRUE WHERE id = ${row.id}`;

  const dyads = (await sql`SELECT * FROM dyad WHERE id = ${row.dyad_id} LIMIT 1`) as Dyad[];
  const dyad = dyads[0];
  if (!dyad) return badRequest('BadCode');
  if (dyad.status && dyad.status !== 'active') return badRequest('AccountPendingApproval');

  return ok({ jwt: await issueDyadJwt(dyad), alias: dyad.alias, child_name: dyad.child_name });
}

export async function OPTIONS() { return new Response(null, { status: 204 }); }
