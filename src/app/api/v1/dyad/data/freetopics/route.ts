import { sql, ensureSchema } from '@/lib/db';
import { dyadFromRequest } from '@/lib/auth';
import { ok, unauthorized } from '@/lib/responses';
import type { FreeTopicDetail } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  await ensureSchema();
  const dyad = await dyadFromRequest(req);
  if (!dyad) return unauthorized();
  const details = (await sql`
    SELECT id, subtopic, subtopic_description
    FROM free_topic
    WHERE dyad_id = ${dyad.id}
    ORDER BY created_at ASC
  `) as FreeTopicDetail[];
  return ok({ dyad_id: dyad.id, details });
}
