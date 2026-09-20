import { test, expect } from '@playwright/test';
import { GUEST, holdModel, signInViaForm } from './helpers';

// One end-to-end pass through the real thing: the sign-in form talks to the local backend (Neon), lands on the welcome
// screen, and the play button creates a session row and navigates to the board. The model is held back (see helpers),
// so the board is asserted in its loading state — the rest of the loop needs the ~520 MB model and is not covered here.

test.describe('smoke', () => {
  test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 1180, height: 820 } });

  test('guest signs in, lands on home, can start a session', async ({ page }) => {
    await holdModel(page);
    await signInViaForm(page, GUEST);
    // A guest whose profile has no age yet is routed through the one-time /setup screen first; either way /home follows.
    if (/#\/setup/.test(page.url())) {
      await page.evaluate(() => localStorage.setItem('irisspeak_app_setup_done', 'true'));
      await page.goto('/#/home');
    }
    await expect(page).toHaveURL(/#\/home/);
    await expect(page.getByRole('heading', { name: /^Welcome,/ })).toBeVisible();
    await expect(page.getByText('Start a conversation')).toBeVisible();
    const play = page.getByRole('button', { name: 'Start a conversation' });
    await expect(play).toBeVisible();
    // The token really is in localStorage under the app's prefix (engine/store.ts) — that's what keeps RequireAuth happy.
    expect(await page.evaluate(() => localStorage.getItem('irisspeak_app_jwt'))).toBeTruthy();

    // Start a conversation: POST /dyad/session/new via the Vite → :3000 proxy, then the board route.
    await play.click();
    await expect(page).toHaveURL(/#\/session\/[^/]+$/, { timeout: 30_000 });
    await expect(page.getByText(/Loading|Starting your session|Downloading the model/).first()).toBeVisible();
    // Nothing on the page should have thrown (index.html keeps the first runtime errors in window.__errs).
    const errs = await page.evaluate(() => ((window as any).__errs as string[]) || []);
    expect(errs.filter(e => !/model CDN unreachable|ResizeObserver/.test(e))).toEqual([]);

    // Tidy up: the play button created a real `session` row on the guest account. Delete it (DELETE …/abort removes the
    // row) so every verify run doesn't leave one more empty conversation in the guest's Stars list and the admin's Users
    // page. Best-effort — a failure here is not a product bug.
    const sid = decodeURIComponent(page.url().replace(/^.*#\/session\//, ''));
    const status = await page.evaluate(async (id) => {
      const jwt = JSON.parse(localStorage.getItem('irisspeak_app_jwt') || 'null');
      const r = await fetch(`/api/v1/dyad/session/${encodeURIComponent(id)}/abort`, { method: 'DELETE', headers: { authorization: `Bearer ${jwt}` } });
      return r.status;
    }, sid).catch(() => 0);
    test.info().annotations.push({ type: 'cleanup', description: `DELETE session ${sid} → HTTP ${status}` });
  });
});
