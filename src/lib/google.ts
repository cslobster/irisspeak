// "Sign in with Google" for the dyad (parent) accounts, shared by irisspeak.com, irisspeak.org and the
// iOS app. Server-side authorization-code flow: the client sends the browser to /dyad/account/google/start,
// Google sends it back to /dyad/account/google/callback, and we hand the client a normal dyad JWT — so
// nothing else in the API changes and no Google SDK runs in any client (avoids the COOP/popup problems
// of the one-tap widget and keeps the client secret on the server).
//
// Credentials: GCP project "irisspeak" (coolcottontail@gmail.com), Web client "IrisSpeak web";
// GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are Vercel env vars on aaatalk-api.
import { SignJWT, jwtVerify, createRemoteJWKSet } from 'jose';

const ENC = new TextEncoder();
const STATE_SECRET = () => ENC.encode((process.env.AUTH_SECRET || 'dev-secret-change-me') + ':google-state');
const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

export const GOOGLE_CLIENT_ID = () => process.env.GOOGLE_CLIENT_ID || '';
export const GOOGLE_CLIENT_SECRET = () => process.env.GOOGLE_CLIENT_SECRET || '';

/** Where Google sends the browser back to; must match the Web client's authorized redirect URI. */
export function callbackUrl(req: Request): string {
  const configured = process.env.GOOGLE_REDIRECT_URI;
  if (configured) return configured;
  const u = new URL(req.url);
  // Behind Vercel the request URL is already https; keep the deployment host so previews work too.
  return `${u.protocol}//${u.host}/api/v1/dyad/account/google/callback`;
}

/** Client redirect targets we are willing to send a JWT to (fragment/query), nothing else. */
export function isAllowedRedirect(redirect: string): boolean {
  let u: URL;
  try { u = new URL(redirect); } catch { return false; }
  if (u.protocol === 'irisspeak:') return true;                             // iOS app (ASWebAuthenticationSession)
  if (u.protocol === 'http:') return u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:') return false;
  const h = u.hostname;
  return h === 'irisspeak.org' || h === 'www.irisspeak.org' || h === 'irisspeak.com' || h === 'www.irisspeak.com'
    || h.endsWith('.irisspeak.org') || h.endsWith('.irisspeak.com') || h.endsWith('.pages.dev') || h.endsWith('.vercel.app');
}

/** Short-lived signed state so the callback can trust the redirect target it was given. */
export async function signState(redirect: string): Promise<string> {
  return await new SignJWT({ redirect })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(STATE_SECRET());
}
export async function readState(state: string): Promise<{ redirect: string } | null> {
  try {
    const { payload } = await jwtVerify(state, STATE_SECRET(), { algorithms: ['HS256'] });
    const redirect = String((payload as any).redirect || '');
    return redirect && isAllowedRedirect(redirect) ? { redirect } : null;
  } catch { return null; }
}

export function authorizeUrl(state: string, redirectUri: string): string {
  const p = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID(),
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

export interface GoogleIdentity { sub: string; email: string; email_verified: boolean; name: string; given_name: string }

/** Exchange the authorization code and verify the ID token against Google's keys. */
export async function exchangeCode(code: string, redirectUri: string): Promise<GoogleIdentity> {
  const body = new URLSearchParams({
    code, client_id: GOOGLE_CLIENT_ID(), client_secret: GOOGLE_CLIENT_SECRET(),
    redirect_uri: redirectUri, grant_type: 'authorization_code',
  });
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
  });
  const tok = await r.json().catch(() => ({}));
  if (!r.ok || !tok.id_token) throw new Error(`token exchange failed: ${tok.error || r.status}`);
  const { payload } = await jwtVerify(tok.id_token, GOOGLE_JWKS, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: GOOGLE_CLIENT_ID(),
  });
  const p = payload as any;
  if (!p.sub) throw new Error('no subject in id_token');
  return {
    sub: String(p.sub), email: String(p.email || '').toLowerCase(), email_verified: !!p.email_verified,
    name: String(p.name || ''), given_name: String(p.given_name || ''),
  };
}

/** Append `params` to a client redirect. Hash-routed apps get them after the hash route
 *  (https://irisspeak.org/#/google?jwt=…); path-routed apps get a fragment (https://irisspeak.com/google#jwt=…)
 *  so the token never appears in a request line or server log. */
export function withParams(redirect: string, params: Record<string, string>): string {
  const q = new URLSearchParams(params).toString();
  if (redirect.includes('#')) return `${redirect}${redirect.includes('?') ? '&' : '?'}${q}`;
  return `${redirect}#${q}`;
}
