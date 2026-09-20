import { test as setup } from '@playwright/test';
import { holdModel, signInViaForm } from './helpers';

// Runs once before the `chromium` project (see playwright.config.ts `dependencies`): signs in as the seeded guest
// account and saves the resulting localStorage (the dyad JWT lives in `irisspeak_app_jwt`) so every other test can
// start already signed in instead of paying for a Neon round trip each.
const STATE = 'e2e/.auth/guest.json';

setup('sign in as guest and save storage state', async ({ page }) => {
  await holdModel(page);
  await signInViaForm(page);
  // A profile with no age set is sent to /setup on every RequireAuth route (App.tsx needsSetup()). The screens behind it
  // are what we want to reach, so mark first-run setup as done — /setup itself stays directly reachable regardless, and
  // the no-scroll suite visits it explicitly. Same localStorage key markSetupDone() writes (engine/store.ts PREFIX).
  await page.evaluate(() => localStorage.setItem('irisspeak_app_setup_done', 'true'));
  await page.context().storageState({ path: STATE });
});
