import { SignJWT, jwtVerify } from 'jose';
import type { Dyad } from './types';
import { sql, ensureSchema } from './db';

const ENC = new TextEncoder();
const SECRET = () => ENC.encode(process.env.AUTH_SECRET || 'dev-secret-change-me');
const ALG = 'HS256';

export interface JwtPayload {
  sub: string;          // dyad id
  alias: string;
  child_name: string;
  child_gender: string;
  parent_type: string;
  locale: string;
}

export async function issueDyadJwt(dyad: Dyad): Promise<string> {
  return await new SignJWT({
    alias: dyad.alias,
    child_name: dyad.child_name,
    child_gender: dyad.child_gender,
    parent_type: dyad.parent_type,
    locale: dyad.locale,
  })
    .setProtectedHeader({ alg: ALG })
    .setSubject(dyad.id)
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(SECRET());
}

export async function verifyDyadJwt(token: string): Promise<JwtPayload> {
  const { payload } = await jwtVerify(token, SECRET(), { algorithms: [ALG] });
  return payload as unknown as JwtPayload;
}

/** Pull JWT out of the Authorization header and return the dyad row, or null. */
export async function dyadFromRequest(req: Request): Promise<Dyad | null> {
  const auth = req.headers.get('authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  try {
    const claims = await verifyDyadJwt(m[1]);
    await ensureSchema();
    const rows = (await sql`SELECT * FROM dyad WHERE id = ${claims.sub} LIMIT 1`) as Dyad[];
    return rows[0] || null;
  } catch {
    return null;
  }
}
