import { sql, ensureSchema } from '@/lib/db';
import { ok, badRequest } from '@/lib/responses';
import { capitalizeName } from '@/lib/text';
import { nanoid } from 'nanoid';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Public (no auth) — self-serve signup wizard. Lands in 'pending' status; the login code the
// parent chose here is stored INACTIVE (dyad_login_code.active = FALSE) so it can't be used to
// log in until an admin approves (POST /api/v1/admin/dyads/[id]/approve) flips it active. This
// is deliberate: the parent picks their own code at signup time — the earlier version of this
// route had the admin auto-generate a random code on approval instead, which left no way for
// the parent to ever find out what it was. Field list is deliberately narrower than the camp's
// real intake form — see docs/prd-personalization-core.md for what was excluded and why (camp
// logistics stay in the camp's own intake; medical/diagnosis data is excluded from the app
// entirely).
export async function POST(req: Request) {
  await ensureSchema();

  const body = await req.json().catch(() => ({}));
  const {
    child_name, child_gender, parent_type, locale, login_code,
    age, communication_style, notes, parent_email,
    interests, // string[] — each becomes an auto-approved Custom Vocabulary Word at signup time
  } = body;

  if (!child_name || !child_gender || !parent_type || !login_code) {
    return badRequest('child_name, child_gender, parent_type, and login_code are required');
  }

  const id = nanoid();
  const childNameVal = capitalizeName(child_name);
  const alias = `${childNameVal.toLowerCase().replace(/[^a-z0-9]/g, '')}-${nanoid(5)}`;

  await sql`
    INSERT INTO dyad (id, alias, child_name, child_gender, parent_type, locale, age, communication_style, notes, parent_email, status)
    VALUES (${id}, ${alias}, ${childNameVal}, ${child_gender}, ${parent_type}, ${locale || 'en'}, ${age ?? null}, ${communication_style ?? null}, ${notes ?? null}, ${parent_email ?? null}, 'pending')
  `;
  await sql`
    INSERT INTO dyad_login_code (code, dyad_id, active) VALUES (${String(login_code)}, ${id}, FALSE)
  `;

  const interestList: string[] = Array.isArray(interests)
    ? interests.map(String).map((s) => s.trim()).filter(Boolean)
    : [];
  for (const word of interestList) {
    await sql`
      INSERT INTO dyad_custom_word (id, dyad_id, word, category, source)
      VALUES (${nanoid()}, ${id}, ${word}, 'topic', 'parent')
    `;
  }

  return ok({ id, alias, status: 'pending' });
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
