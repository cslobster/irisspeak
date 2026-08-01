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
    SELECT age, notes, communication_style FROM dyad WHERE id = ${dyad.id} LIMIT 1
  `;
  return ok(row);
}

export async function PATCH(req: Request) {
  const dyad = await dyadFromRequest(req);
  if (!dyad) return unauthorized();
  await ensureSchema();

  const body = await req.json().catch(() => ({}));
  const { age, notes, communication_style } = body;

  await sql`
    UPDATE dyad SET
      age                  = COALESCE(${age ?? null}, age),
      notes                = COALESCE(${notes ?? null}, notes),
      communication_style  = COALESCE(${communication_style ?? null}, communication_style)
    WHERE id = ${dyad.id}
  `;

  const [row] = await sql`
    SELECT age, notes, communication_style FROM dyad WHERE id = ${dyad.id} LIMIT 1
  `;
  return ok(row);
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
