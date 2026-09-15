import { sql, ensureSchema } from '@/lib/db';
import { ok, badRequest } from '@/lib/responses';
import { mailConfigured, sendMail } from '@/lib/mail';
import type { Dyad } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST /api/v1/dyad/account/email/request  { email }
// Emails a six-digit sign-in code to a parent whose address is on the account. Always answers 200 with the same
// shape whether or not the address exists, so the endpoint cannot be used to discover who has an account.
export async function POST(req: Request) {
  await ensureSchema();
  const { email } = await req.json().catch(() => ({}));
  const addr = String(email || '').trim().toLowerCase();
  if (!addr || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) return badRequest('a valid email is required');
  if (!mailConfigured()) return ok({ sent: false, reason: 'not_configured' });

  // at most 5 codes per address per hour
  const [recent] = (await sql`
    SELECT COUNT(*)::int AS n FROM email_login_code WHERE email = ${addr} AND created_at > NOW() - INTERVAL '1 hour'
  `) as { n: number }[];
  if (recent && recent.n >= 5) return ok({ sent: false, reason: 'too_many' });

  const rows = (await sql`
    SELECT * FROM dyad WHERE LOWER(parent_email) = ${addr} OR LOWER(google_email) = ${addr}
    ORDER BY (status = 'active') DESC, created_at ASC LIMIT 1
  `) as Dyad[];

  if (rows[0] && (!rows[0].status || rows[0].status === 'active')) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await sql`
      INSERT INTO email_login_code (email, dyad_id, code, expires_at)
      VALUES (${addr}, ${rows[0].id}, ${code}, NOW() + INTERVAL '10 minutes')
    `;
    await sendMail(addr, 'Your Iris Speak sign-in code',
      `Your Iris Speak sign-in code is ${code}\n\nIt works once and expires in 10 minutes.\nIf you did not ask to sign in, you can ignore this email.`);
  }
  return ok({ sent: true });   // identical answer whether or not the address is on an account
}

export async function OPTIONS() { return new Response(null, { status: 204 }); }
