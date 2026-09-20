import { expect, type Page, type TestInfo } from '@playwright/test';
import fs from 'fs';
import path from 'path';

export const GUEST = { username: 'guest', password: '12345' } as const;   // seeded by src/lib/db.ts ensureSchema()

/** The three viewports the product is judged at: iPad landscape, iPad landscape with Safari's tab bar eating 100 px,
 *  and a phone (which flips the app into CompactSession — <900 wide or <600 tall). */
export const VIEWPORTS = [
  { name: 'ipad-landscape', width: 1180, height: 820 },
  { name: 'ipad-safari-tabs', width: 1180, height: 720 },
  { name: 'phone', width: 390, height: 844 },
] as const;

/** Keep the ~520 MB on-device model out of the tests. A fresh browser context has no Cache Storage, so without this every
 *  test would start downloading it from R2 (via Vite's /model-cdn proxy in dev). Holding the requests open (never
 *  fulfilling or aborting) leaves the app in its honest "Loading…" state, which is exactly what a user sees for the first
 *  minute on a new device — and that state's layout is what we want to check. Aborting instead would surface the
 *  "model load failed" error path, which is a different (and rarer) screen. */
export async function holdModel(page: Page) {
  await page.route('**/model-cdn/**', () => { /* intentionally never resolved */ });
  await page.route('**://model.irisspeak.org/**', () => { /* prod CDN, in case a build ever bypasses the proxy */ });
}

/** Sign in through the real form (Google is the primary path in the UI; the username + login-code form sits behind a
 *  link). Resolves once the app has left the sign-in route — /home, or /setup on a first-run profile. */
export async function signInViaForm(page: Page, creds: { username: string; password: string } = GUEST) {
  await page.goto('/#/');
  await page.getByRole('button', { name: /username and password/i }).click();
  await page.getByPlaceholder('Enter username').fill(creds.username);
  await page.getByPlaceholder('Enter password').fill(creds.password);
  await page.getByRole('button', { name: /^Sign in/ }).click();
  // Neon's free tier sleeps between runs; the first login of a run is the slow one.
  await expect(page).toHaveURL(/#\/(home|setup)/, { timeout: 30_000 });
}

/** Everything the no-scroll rule cares about, measured in one round trip. `scrollHeight` counts content that overflows
 *  even when CSS `overflow: hidden` stops the user from reaching it — clipped content is as much a violation as a
 *  scrollbar, so that is the number we compare against the viewport. */
export function measureOverflow(page: Page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    const root = document.getElementById('root');
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      doc: { scrollWidth: de.scrollWidth, scrollHeight: de.scrollHeight },
      root: root ? { scrollWidth: root.scrollWidth, scrollHeight: root.scrollHeight } : null,
    };
  });
}

/** The core assertion. Waits for the app to have rendered something and for web fonts (OpenDyslexic is wider than the
 *  fallback, so a layout that fits in Arial can still overflow once the real font lands), then polls the measurements
 *  briefly so a late re-layout doesn't produce a flaky pass. On failure, saves a full-page screenshot — the only way to
 *  see *what* overflowed — under e2e/__screenshots__/. */
export async function expectNoScroll(page: Page, testInfo: TestInfo, screen: string, vp: { name: string; width: number; height: number }) {
  await expect(page.locator('#root > *').first()).toBeAttached();
  await page.evaluate(() => (document as any).fonts?.ready);
  await page.waitForTimeout(250);   // let ResizeObserver / --fit-scale settle after fonts swap in
  const m = await measureOverflow(page);
  const problems: string[] = [];
  if (m.doc.scrollHeight > m.innerHeight) problems.push(`document scrolls vertically: scrollHeight ${m.doc.scrollHeight} > innerHeight ${m.innerHeight}`);
  if (m.doc.scrollWidth > m.innerWidth) problems.push(`document scrolls horizontally: scrollWidth ${m.doc.scrollWidth} > innerWidth ${m.innerWidth}`);
  if (!m.root) problems.push('#root not found');
  else {
    if (m.root.scrollHeight > m.innerHeight) problems.push(`#root scrolls vertically: scrollHeight ${m.root.scrollHeight} > innerHeight ${m.innerHeight}`);
    if (m.root.scrollWidth > m.innerWidth) problems.push(`#root scrolls horizontally: scrollWidth ${m.root.scrollWidth} > innerWidth ${m.innerWidth}`);
  }
  if (problems.length && testInfo.expectedStatus !== 'failed') {   // no screenshots for KNOWN_OVERFLOW locks (see no-scroll.e2e.ts)
    const dir = path.join(testInfo.project.outputDir);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${screen.replace(/[^a-z0-9]+/gi, '-')}-${vp.width}x${vp.height}.png`);
    await page.screenshot({ path: file, fullPage: true }).catch(() => {});
    await testInfo.attach('overflow', { path: file, contentType: 'image/png' }).catch(() => {});
  }
  expect(problems, `"${screen}" at ${vp.name} (${vp.width}×${vp.height}) must not scroll — see ${testInfo.project.outputDir}`).toEqual([]);
}
