import { sql, ensureSchema } from '@/lib/db';
import { issueDyadJwt } from '@/lib/auth';
import { ok, badRequest } from '@/lib/responses';
import type { Dyad, FreeTopicDetail } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  await ensureSchema();
  const { username, password } = await req.json().catch(() => ({}));
  if (!username || !password) return badRequest('username and password required');

  // username may be the alias (signup-wizard/admin accounts) or the parent email (Google accounts,
  // which get a random unmemorable alias — see google/callback and account/password routes).
  const rows = (await sql`
    SELECT d.* FROM dyad_login_code lc
    JOIN dyad d ON d.id = lc.dyad_id
    WHERE (LOWER(d.alias) = LOWER(${String(username)}) OR LOWER(d.parent_email) = LOWER(${String(username)}))
      AND lc.code = ${String(password)} AND lc.active = TRUE
    LIMIT 1
  `) as Dyad[];

  if (!rows[0]) return badRequest('NoSuchUser');

  const dyad = rows[0];
  // Signup-wizard accounts start 'pending' until an admin approves them (see
  // CONTEXT.md's Custom Vocabulary Word / Profile Fact design session and
  // docs/prd-personalization-core.md) — admin-created/seeded dyads default to
  // 'active' via the ALTER TABLE default, so this doesn't affect existing accounts.
  if (dyad.status && dyad.status !== 'active') return badRequest('AccountPendingApproval');
  const jwt = await issueDyadJwt(dyad);

  const topics = (await sql`
    SELECT id, subtopic, subtopic_description
    FROM free_topic
    WHERE dyad_id = ${dyad.id}
    ORDER BY created_at ASC
  `) as FreeTopicDetail[];

  return ok({ jwt, free_topics: topics, child_name: dyad.child_name, alias: dyad.alias });
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
