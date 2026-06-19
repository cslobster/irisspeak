import { issueAdminJwt } from '@/lib/auth';
import { ok, unauthorized } from '@/lib/responses';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { password } = await req.json().catch(() => ({}));
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) return unauthorized('ADMIN_PASSWORD not configured');
  if (!password || password !== adminPassword) return unauthorized('Invalid password');
  const token = await issueAdminJwt();
  return ok({ token });
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
