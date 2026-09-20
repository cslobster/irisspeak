import { test, expect, type Page } from '@playwright/test';
import { VIEWPORTS, expectNoScroll, holdModel } from './helpers';

// The product's #1 UX rule: NO SCREEN SCROLLS — everything zoom-to-fits the viewport (CLAUDE.md). This visits every route
// that renders without the on-device model and asserts neither the document nor #root overflows the viewport, at the
// three sizes that matter (iPad landscape, iPad with Safari tabs, phone/compact). A failure here is a real product bug in
// web-client/, not a test problem — report it, don't loosen the assertion.
//
// The model (~520 MB) is never downloaded: holdModel() parks every /model-cdn/ request, so the session board is checked
// in its "Loading…" state (the screen a child sees for the first minute on a new device). The board *with* cards needs
// the model → see the test.skip at the bottom.

type Screen = {
  name: string; path: string; signedOut?: boolean;
  /** Backend calls the screen makes on mount: the test waits for each response before measuring, because a
   *  data-driven screen (Stars = every past session) is at its tallest only once the data is in — measuring the empty
   *  first paint would pass for the wrong reason. Listeners are armed before goto() so a fast response can't be missed. */
  awaitResponses?: RegExp[];
  ready: (page: Page) => Promise<void>;
};

const SESSION_ID = `e2e-${Date.now().toString(36)}`;   // SessionScreen doesn't require the id to exist locally or remotely

// KNOWN OVERFLOWS — real product bugs found the first time this suite ran (2026-09-20), kept as `test.fail` locks so
// `npm run verify` stays green while they are open. Every entry is a screen that genuinely overflows the viewport today
// (numbers = document.scrollHeight measured vs innerHeight). A lock flips the test to "expected to fail": the moment the
// screen is fixed the test FAILS with "expected to fail, but passed" — that's the cue to delete its entry. Never add to
// this table to make a new regression go away; fix the screen in web-client/ instead.
const KNOWN_OVERFLOW: Record<string, string> = {
  'setup@ipad-landscape':      'SetupScreen: 920 px of content in an 820 px viewport (Done button below the fold)',
  'setup@ipad-safari-tabs':    'SetupScreen: 920 px in 720',
  'setup@phone':               'SetupScreen: 962 px in 844',
  'stars@ipad-landscape':      'StarsScreen lists every past session in one column (min-h-screen, no fit/paging): 6160 px in 820 on the guest account',
  'stars@ipad-safari-tabs':    'StarsScreen: 6160 px in 720',
  'stars@phone':               'StarsScreen: 7864 px in 844',
  'credits@ipad-safari-tabs':  'CreditsScreen: 808 px in 720 (four licence cards + footer do not fit once Safari tabs take 100 px)',
  'credits@phone':             'CreditsScreen: 1111 px in 844',
  'signup@ipad-landscape':     'SignupWizardScreen step 1: 956 px in 820',
  'signup@ipad-safari-tabs':   'SignupWizardScreen step 1: 956 px in 720',
  'signup@phone':              'SignupWizardScreen step 1: 1046 px in 844',
};
function lockKnown(screen: string, vp: string) {
  const why = KNOWN_OVERFLOW[`${screen}@${vp}`];
  if (why) test.fail(true, `KNOWN OVERFLOW (product bug, open): ${why}. Fix the screen, then delete this entry from KNOWN_OVERFLOW.`);
}

const SCREENS: Screen[] = [
  { name: 'sign-in', path: '/#/', signedOut: true,
    ready: async p => { await expect(p.getByRole('heading', { name: 'Iris Speak' })).toBeVisible(); } },
  // The taller variant: username + password fields expanded under the Google button.
  { name: 'sign-in-password-form', path: '/#/', signedOut: true,
    ready: async p => { await p.getByRole('button', { name: /username and password/i }).click(); await expect(p.getByPlaceholder('Enter password')).toBeVisible(); } },
  { name: 'signup', path: '/#/signup', signedOut: true,
    ready: async p => { await expect(p).toHaveURL(/#\/signup/); } },
  { name: 'home', path: '/#/home',
    ready: async p => { await expect(p.getByRole('button', { name: 'Start a conversation' })).toBeVisible(); } },
  { name: 'setup', path: '/#/setup',
    ready: async p => { await expect(p).toHaveURL(/#\/setup/); } },
  { name: 'stars', path: '/#/stars', awaitResponses: [/\/dyad\/session\/list/],
    ready: async p => { await expect(p).toHaveURL(/#\/stars/); await expect(p.getByRole('heading', { name: 'Your conversations' })).toBeVisible(); } },
  { name: 'vocabulary', path: '/#/vocabulary', awaitResponses: [/\/dyad\/vocabulary/],
    ready: async p => { await expect(p).toHaveURL(/#\/vocabulary/); await expect(p.getByText('Loading…')).toBeHidden(); } },
  { name: 'profile', path: '/#/profile', awaitResponses: [/\/dyad\/profile/],
    ready: async p => { await expect(p).toHaveURL(/#\/profile/); await expect(p.getByText('Loading…')).toBeHidden(); } },
  { name: 'credits', path: '/#/credits',
    ready: async p => { await expect(p).toHaveURL(/#\/credits/); } },
  { name: 'session-loading', path: `/#/session/${SESSION_ID}`,
    ready: async p => { await expect(p).toHaveURL(/#\/session\//); await expect(p.getByText(/Loading|Starting your session|Downloading the model/).first()).toBeVisible(); } },
  { name: 'session-end', path: `/#/session-end/${SESSION_ID}`, awaitResponses: [/\/message\/all/, /\/dyad\/session\/list/],
    ready: async p => { await expect(p).toHaveURL(/#\/session-end\//); } },
];

for (const vp of VIEWPORTS) {
  test.describe(`${vp.name} ${vp.width}×${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const s of SCREENS.filter(s => !s.signedOut)) {
      test(`${s.name} does not scroll`, async ({ page }, testInfo) => {
        lockKnown(s.name, vp.name);
        await holdModel(page);
        const responses = (s.awaitResponses || []).map(re => page.waitForResponse(r => re.test(r.url())));
        await page.goto(s.path);
        await Promise.all(responses);
        await s.ready(page);
        await expectNoScroll(page, testInfo, s.name, vp);
      });
    }

    test.describe('signed out', () => {
      test.use({ storageState: { cookies: [], origins: [] } });   // drop the saved guest token: these routes redirect to /home when signed in
      for (const s of SCREENS.filter(s => s.signedOut)) {
        test(`${s.name} does not scroll`, async ({ page }, testInfo) => {
          lockKnown(s.name, vp.name);
          await holdModel(page);
          await page.goto(s.path);
          await s.ready(page);
          await expectNoScroll(page, testInfo, s.name, vp);
        });
      }
    });

    // The board with cards on it (Topic 15 / Action 3 / Feeling 3 + quick row) only renders after engine.load() resolves,
    // which means the real ~520 MB model from R2 — far too slow and heavy for a per-push check, and there is no stub
    // path in engine/model.ts that produces a fake ranking. Until one exists, the populated board is covered only by the
    // loading state above and by hand-testing on an iPad.
    test.skip('session board with cards does not scroll (needs the on-device model)', async () => {});
  });
}
