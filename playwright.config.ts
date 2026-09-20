import { defineConfig, devices } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// End-to-end suite for the web app (web-client/). The main assertion is the product's #1 UX rule — no screen scrolls at
// iPad or phone sizes — see e2e/no-scroll.e2e.ts. Runs against the two dev servers the developer normally already has up
// (backend :3000, Vite :4200); `reuseExistingServer` means we attach to them if present and boot them if not (CI).
//
// Vite serves HTTPS on 4200 when web-client/.certs/ exists (self-signed, for iPad-on-LAN testing), plain HTTP otherwise —
// pick the matching scheme so baseURL agrees with whatever is (or will be) listening. E2E_BASE_URL overrides both.
const HTTPS = fs.existsSync(path.join(__dirname, 'web-client', '.certs', 'key.pem'));
const BASE_URL = process.env.E2E_BASE_URL || `${HTTPS ? 'https' : 'http'}://localhost:4200`;
const CI = !!process.env.CI;

export default defineConfig({
  testDir: 'e2e',
  // `.e2e.ts`, not `.spec.ts`: the root `npm test` is vitest with its default include glob (**/*.{test,spec}.ts), which
  // would otherwise pick these files up and choke on @playwright/test — and vitest.config.ts isn't ours to edit.
  testMatch: /.*\.e2e\.ts$/,
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 2 : 4,
  reporter: CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : [['list']],
  // Failure artefacts (Playwright's own screenshots/traces, plus the full-page screenshots the no-scroll test takes on
  // failure) all land here. Git-ignored — never commit screenshots.
  outputDir: 'e2e/__screenshots__',
  timeout: 60_000,          // Neon's free tier sleeps: the first backend call of a run can take a couple of seconds
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE_URL,
    ignoreHTTPSErrors: true,    // the dev cert is self-signed
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    // Signs in once (guest / 12345) and saves the localStorage token; every other test starts from that state.
    { name: 'setup', testMatch: /auth\.setup\.e2e\.ts$/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/guest.json' },
      dependencies: ['setup'],
      testIgnore: /auth\.setup\.e2e\.ts$/,
    },
  ],
  webServer: [
    {
      command: 'npm run dev',
      cwd: __dirname,
      url: 'http://localhost:3000/api/v1/ping',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: 'npm run dev',
      cwd: path.join(__dirname, 'web-client'),
      url: BASE_URL,
      ignoreHTTPSErrors: true,
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
