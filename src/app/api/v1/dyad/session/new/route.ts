import { sql, ensureSchema } from '@/lib/db';
import { dyadFromRequest } from '@/lib/auth';
import { ok, unauthorized, badRequest } from '@/lib/responses';
import { nanoid } from 'nanoid';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  await ensureSchema();
  const dyad = await dyadFromRequest(req);
  if (!dyad) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const topic = body?.topic;
  if (!topic?.category) return badRequest('topic.category required');

  const id = nanoid();
  await sql`
    INSERT INTO session (id, dyad_id, topic_category, subtopic, subtopic_description, local_timezone, status, client)
    VALUES (${id}, ${dyad.id}, ${topic.category}, ${topic.subtopic ?? null}, ${topic.subtopic_description ?? null}, ${body.timezone ?? null}, 'initial', ${body.client ?? null})
  `;
  // Backend's old contract: returns the session id as a JSON string.
  return ok(id);
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
