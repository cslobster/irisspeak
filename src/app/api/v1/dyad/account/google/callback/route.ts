import { NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { sql, ensureSchema } from '@/lib/db';
import { issueDyadJwt } from '@/lib/auth';
import { badRequest } from '@/lib/responses';
import { capitalizeName } from '@/lib/text';
import { callbackUrl, exchangeCode, readState, withParams } from '@/lib/google';
import type { Dyad } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/v1/dyad/account/google/callback?code=…&state=…   (Google redirects here)
// Finds the dyad for this Google account — by google_sub, else by the parent_email given at signup
// (linking it) — or creates a new, immediately active dyad, then sends the browser back to the client
// with a dyad JWT. The client treats that JWT exactly like one from /dyad/account/login.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const state = await readState(url.searchParams.get('state') || '');
  if (!state) return badRequest('bad state');
  const fail = (error: string) => NextResponse.redirect(withParams(state.redirect, { error }), 302);

  const code = url.searchParams.get('code');
  if (!code) return fail(url.searchParams.get('error') || 'access_denied');

  let who;
  try { who = await exchangeCode(code, callbackUrl(req)); }
  catch (e: any) { console.error('google callback', e?.message || e); return fail('google_exchange_failed'); }
  if (!who.email || !who.email_verified) return fail('email_not_verified');

  await ensureSchema();
  let rows = (await sql`SELECT * FROM dyad WHERE google_sub = ${who.sub} LIMIT 1`) as Dyad[];
  let isNew = false;
  if (!rows[0]) {
    // Link an existing signup-wizard/admin account that gave this email as the parent email.
    rows = (await sql`
      SELECT * FROM dyad WHERE google_sub IS NULL AND LOWER(parent_email) = ${who.email}
      ORDER BY (status = 'active') DESC, created_at ASC LIMIT 1
    `) as Dyad[];
    if (rows[0]) {
      await sql`UPDATE dyad SET google_sub = ${who.sub}, google_email = ${who.email} WHERE id = ${rows[0].id}`;
    } else {
      isNew = true;
      const id = nanoid();
      const first = capitalizeName(who.given_name || who.name.split(' ')[0] || 'Friend');
      const alias = `${first.toLowerCase().replace(/[^a-z0-9]/g, '') || 'family'}-${nanoid(5)}`;
      await sql`
        INSERT INTO dyad (id, alias, child_name, child_gender, locale, parent_email, status, google_sub, google_email)
        VALUES (${id}, ${alias}, ${first}, 'girl', 'en', ${who.email}, 'active', ${who.sub}, ${who.email})
      `;
      rows = (await sql`SELECT * FROM dyad WHERE id = ${id} LIMIT 1`) as Dyad[];
    }
  }
  const dyad = rows[0];
  if (dyad.status && dyad.status !== 'active') return fail('AccountPendingApproval');

  const jwt = await issueDyadJwt(dyad);
  const params: Record<string, string> = { jwt, alias: dyad.alias, child_name: dyad.child_name };
  if (isNew) params.new = '1';
  return NextResponse.redirect(withParams(state.redirect, params), 302);
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
