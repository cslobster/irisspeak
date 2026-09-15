// Outbound email for sign-in codes. Resend is the provider: set RESEND_API_KEY (and optionally MAIL_FROM,
// default "Iris Speak <login@irisspeak.com>", whose domain must be verified in Resend) on the API project.
// With no key configured, send() reports `not_configured` and nothing is sent — the sign-in screen then tells
// the parent to use Google or their login code. Codes are never logged.
export const mailConfigured = () => !!process.env.RESEND_API_KEY;

export async function sendMail(to: string, subject: string, text: string): Promise<{ ok: boolean; reason?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, reason: 'not_configured' };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: process.env.MAIL_FROM || 'Iris Speak <login@irisspeak.com>', to: [to], subject, text }),
    });
    if (!r.ok) { console.error('mail send failed', r.status, (await r.text()).slice(0, 200)); return { ok: false, reason: 'send_failed' }; }
    return { ok: true };
  } catch (e: any) {
    console.error('mail send error', e?.message || e);
    return { ok: false, reason: 'send_failed' };
  }
}
