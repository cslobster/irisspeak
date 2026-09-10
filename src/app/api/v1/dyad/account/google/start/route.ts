import { NextResponse } from 'next/server';
import { badRequest } from '@/lib/responses';
import { authorizeUrl, callbackUrl, GOOGLE_CLIENT_ID, isAllowedRedirect, signState } from '@/lib/google';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/v1/dyad/account/google/start?redirect=<client url>
// Public. Sends the browser to Google's consent page; see src/lib/google.ts for the whole flow.
export async function GET(req: Request) {
  if (!GOOGLE_CLIENT_ID()) return badRequest('Google sign-in is not configured');
  const url = new URL(req.url);
  const redirect = url.searchParams.get('redirect') || '';
  if (!isAllowedRedirect(redirect)) return badRequest('redirect not allowed');
  const state = await signState(redirect);
  return NextResponse.redirect(authorizeUrl(state, callbackUrl(req)), 302);
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
