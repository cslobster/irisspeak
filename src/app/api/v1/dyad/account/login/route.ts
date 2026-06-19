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

  const rows = (await sql`
    SELECT d.* FROM dyad_login_code lc
    JOIN dyad d ON d.id = lc.dyad_id
    WHERE d.alias = ${String(username)} AND lc.code = ${String(password)} AND lc.active = TRUE
    LIMIT 1
  `) as Dyad[];

  if (!rows[0]) return badRequest('NoSuchUser');

  const dyad = rows[0];
  const jwt = await issueDyadJwt(dyad);

  const topics = (await sql`
    SELECT id, subtopic, subtopic_description
    FROM free_topic
    WHERE dyad_id = ${dyad.id}
    ORDER BY created_at ASC
  `) as FreeTopicDetail[];

  return ok({ jwt, free_topics: topics, child_name: dyad.child_name });
}
