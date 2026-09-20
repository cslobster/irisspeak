import { sql, ensureSchema } from '@/lib/db';
import { dyadFromRequest } from '@/lib/auth';
import { ok, unauthorized, badRequest, serverError } from '@/lib/responses';
import { nanoid } from 'nanoid';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_SCREENSHOT_CHARS = 4_000_000;   // ~3MB of image behind base64's ~4/3 overhead
const MAX_CONTEXT_CHARS = 100_000;

/**
 * A parent flagging something wrong with the app itself — the "Report a problem" button, separate
 * from board_feedback (the model's word-choice feedback under the Feedback button). Carries an
 * in-app screenshot, a free-text description, and whatever conversation context the client had
 * handy, so support isn't triaging from one image with no words.
 *   POST { description, screenshot?: base64 data URL, session_id?, context?: object, client? }
 *   GET  the family's own reports, newest first
 */
export async function POST(req: Request) {
  await ensureSchema();
  const dyad = await dyadFromRequest(req);
  if (!dyad) return unauthorized();
  const body = await req.json().catch(() => ({}));

  const description = String(body.description ?? '').trim().slice(0, 2000);
  if (!description) return badRequest('description required');

  const screenshot = typeof body.screenshot === 'string' ? body.screenshot : null;
  if (screenshot && screenshot.length > MAX_SCREENSHOT_CHARS) return badRequest('screenshot too large');

  let context: unknown = null;
  if (body.context !== undefined && body.context !== null) {
    const json = JSON.stringify(body.context);
    if (json.length > MAX_CONTEXT_CHARS) return badRequest('context too large');
    context = body.context;
  }

  const id = nanoid();
  try {
    await sql`
      INSERT INTO problem_report (id, dyad_id, session_id, description, screenshot_data, context, client)
      VALUES (${id}, ${dyad.id}, ${body.session_id ? String(body.session_id) : null}, ${description}, ${screenshot},
              ${context !== null ? JSON.stringify(context) : null}::jsonb, ${body.client ? String(body.client).slice(0, 40) : null})
    `;
    return ok({ id });
  } catch (e: any) { return serverError(e?.message || 'failed to save report'); }
}

export async function GET(req: Request) {
  await ensureSchema();
  const dyad = await dyadFromRequest(req);
  if (!dyad) return unauthorized();
  const rows = await sql`
    SELECT id, session_id, description, status, created_at FROM problem_report
    WHERE dyad_id = ${dyad.id} ORDER BY created_at DESC LIMIT 200
  `;
  return ok({ reports: rows });
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}
